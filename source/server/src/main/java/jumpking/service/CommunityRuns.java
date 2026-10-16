package jumpking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import jumpking.entity.PlayRun;
import jumpking.exception.ApiException;
import jumpking.game.GameSimulation;
import jumpking.repository.PlayRunRepository;
import org.springframework.stereotype.Service;

@Service
public class CommunityRuns {
  public record Stored(
      String id,
      long owner,
      long revision,
      GameSimulation.Snapshot snapshot,
      double maximum,
      long peak,
      Instant startedAt) {}

  public record Write(
      String id,
      long owner,
      long revision,
      String status,
      GameSimulation.Snapshot snapshot,
      double progress,
      double maximum,
      long peak,
      Instant endedAt) {
    public Write {
      if (endedAt != null) endedAt = endedAt.truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
    }
  }

  private record Existing(
      String status,
      long revision,
      long ticks,
      int jumps,
      int falls,
      double progress,
      double maximum,
      long peak,
      String snapshot,
      Instant endedAt) {
    boolean same(Write next) {
      var physics = next.snapshot().physics();
      return status.equals(next.status())
          && ticks == physics.ticks
          && jumps == physics.jumps
          && falls == physics.falls
          && progress == next.progress()
          && maximum == next.maximum()
          && peak == next.peak()
          && java.util.Objects.equals(endedAt, next.endedAt());
    }
  }

  private final PlayRunRepository runs;
  private final ObjectMapper json;
  private final RunOwners owners;
  private final CrownService crowns;
  private final Clock clock;

  public CommunityRuns(
      PlayRunRepository runs,
      ObjectMapper json,
      RunOwners owners,
      CrownService crowns,
      Clock clock) {
    this.runs = runs;
    this.json = json;
    this.owners = owners;
    this.crowns = crowns;
    this.clock = clock;
  }

  public Stored open(
      long account, boolean replace, String expected, GameSimulation.Snapshot spawn) {
    return owners.write(
        account,
        owner -> {
          var active = runs.lockActiveCommunity(owner).orElse(null);
          var old =
              active == null
                  ? null
                  : new Stored(
                      active.getId(),
                      owner,
                      active.getRevision(),
                      decode(active.getSnapshot()),
                      active.getMaxProgress(),
                      active.getPeakReachedTicks(),
                      active.getStartedAt());
          if (!replace && old != null) return old;
          if (replace && !java.util.Objects.equals(expected, old == null ? null : old.id()))
            throw new ApiException(
                409, "CONFLICT", "Community save changed; refresh before starting a new game");
          var now = clock.instant();
          if (active != null) {
            active.setStatus("ABANDONED");
            active.setSnapshot(null);
            active.setRevision(active.getRevision() + 1);
            active.setEndedAt(now);
            active.setUpdatedAt(now);
            // Hibernate insert trước update: flush lượt cũ để giải phóng generated unique ACTIVE.
            runs.flush();
          }
          String id = UUID.randomUUID().toString();
          var run = new PlayRun();
          run.setId(id);
          run.setUserId(owner);
          run.setKind("COMMUNITY");
          run.setStatus("ACTIVE");
          run.setRevision(1);
          run.setSnapshot(encode(spawn));
          run.setStartedAt(now);
          run.setUpdatedAt(now);
          runs.saveAndFlush(run);
          return new Stored(id, owner, 1, spawn, 0, 0, run.getStartedAt());
        });
  }

  public void save(Write next) {
    var state = next.snapshot().physics();
    if (!java.util.Set.of("ACTIVE", "FINISHED", "ABANDONED").contains(next.status())
        || next.revision() < 1
        || !Double.isFinite(next.progress())
        || !Double.isFinite(next.maximum())
        || next.maximum() < next.progress()
        || next.progress() < 0
        || state.ticks < 0
        || state.jumps < 0
        || state.falls < 0
        || next.peak() < 0
        || next.peak() > state.ticks
        || next.snapshot().world().path("lastTick").asLong() != state.ticks
        || (next.status().equals("ACTIVE") != (next.endedAt() == null)))
      throw new ApiException(409, "CONFLICT", "Invalid Community metrics");
    owners.write(
        next.owner(),
        owner -> {
          var run = runs.lockById(next.id()).orElse(null);
          if (run == null || run.getUserId() != owner || !run.getKind().equals("COMMUNITY"))
            throw new ApiException(409, "CONFLICT", "Community run no longer exists");
          var value =
              new Existing(
                  run.getStatus(),
                  run.getRevision(),
                  run.getPlayTicks(),
                  run.getJumps(),
                  run.getFalls(),
                  run.getCurrentProgress(),
                  run.getMaxProgress(),
                  run.getPeakReachedTicks(),
                  run.getSnapshot(),
                  run.getEndedAt());
          long revision = value.revision();
          if (next.revision() < revision) return null;
          if (next.revision() == revision) {
            if (!value.same(next)
                || (next.status().equals("ACTIVE")
                    && !tree(value.snapshot()).equals(tree(encode(next.snapshot())))))
              throw new ApiException(409, "CONFLICT", "Community revision conflicts");
            return null;
          }
          if (!value.status().equals("ACTIVE"))
            throw new ApiException(409, "CONFLICT", "Community run has already ended");
          if (state.ticks < value.ticks()
              || state.jumps < value.jumps()
              || state.falls < value.falls()
              || next.maximum() < value.maximum()
              || next.peak() < value.peak()
              || (next.maximum() == value.maximum() && next.peak() != value.peak()))
            throw new ApiException(
                409,
                "CONFLICT",
                "Community metrics cannot decrease or change an existing peak time");
          boolean active = next.status().equals("ACTIVE");
          run.setRevision(next.revision());
          run.setStatus(next.status());
          run.setPlayTicks(state.ticks);
          run.setJumps(state.jumps);
          run.setFalls(state.falls);
          run.setCurrentProgress(next.progress());
          run.setMaxProgress(next.maximum());
          run.setPeakReachedTicks(next.peak());
          run.setFinishTicks(next.status().equals("FINISHED") ? state.ticks : null);
          run.setSnapshot(active ? encode(next.snapshot()) : null);
          run.setEndedAt(next.endedAt());
          run.setUpdatedAt(clock.instant());
          if (next.status().equals("FINISHED")) crowns.unlock(owner);
          runs.flush();
          return null;
        });
  }

  private GameSimulation.Snapshot decode(String text) {
    try {
      return json.readValue(text, GameSimulation.Snapshot.class);
    } catch (Exception error) {
      throw new IllegalStateException("Invalid stored Community checkpoint", error);
    }
  }

  private com.fasterxml.jackson.databind.JsonNode tree(String text) {
    try {
      return json.readTree(text);
    } catch (Exception error) {
      throw new IllegalStateException("Invalid checkpoint JSON", error);
    }
  }

  private String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception error) {
      throw new IllegalStateException("Cannot encode Community checkpoint", error);
    }
  }
}
