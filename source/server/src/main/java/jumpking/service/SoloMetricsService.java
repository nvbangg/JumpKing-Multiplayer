package jumpking.service;

import java.time.Clock;
import java.util.UUID;
import jumpking.dto.SoloMetrics;
import jumpking.entity.PlayRun;
import jumpking.exception.ApiException;
import jumpking.repository.PlayRunRepository;
import org.springframework.stereotype.Service;

@Service
public class SoloMetricsService {
  public record Ack(long revision, String syncStatus) {}

  private final PlayRunRepository runs;
  private final RunOwners owners;
  private final CrownService crowns;
  private final Clock clock;

  public SoloMetricsService(
      PlayRunRepository runs, RunOwners owners, CrownService crowns, Clock clock) {
    this.runs = runs;
    this.owners = owners;
    this.crowns = crowns;
    this.clock = clock;
  }

  public Ack save(long account, String id, SoloMetrics incoming) {
    try {
      if (!UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException();
    } catch (IllegalArgumentException invalid) {
      throw new ApiException(400, "VALIDATION", "Invalid run ID");
    }
    incoming.validate();
    return owners.write(
        account,
        owner -> {
          var saved = runs.lockById(id).orElse(null);
          if (saved != null && (saved.getUserId() != owner || !saved.getKind().equals("SOLO")))
            throw new ApiException(404, "NOT_FOUND", "Run not found");
          if (saved != null) {
            var old =
                new SoloMetrics(
                    saved.getRevision(),
                    SoloMetrics.Status.valueOf(saved.getStatus()),
                    saved.getPlayTicks(),
                    saved.getJumps(),
                    saved.getFalls(),
                    saved.getCurrentProgress(),
                    saved.getMaxProgress(),
                    saved.getPeakReachedTicks(),
                    saved.getFinishTicks(),
                    saved.getStartedAt(),
                    saved.getEndedAt());
            if (incoming.revision() < old.revision()) return new Ack(incoming.revision(), "SAVED");
            if (incoming.revision().equals(old.revision())) {
              if (!incoming.sameContent(old))
                throw new ApiException(
                    409, "CONFLICT", "Solo revision already has different metrics");
              return new Ack(incoming.revision(), "SAVED");
            }
            incoming.validateSuccessor(old);
          } else {
            saved = new PlayRun();
            saved.setId(id);
            saved.setUserId(owner);
            saved.setKind("SOLO");
            saved.setStartedAt(incoming.startedAt());
          }
          saved.setRevision(incoming.revision());
          saved.setStatus(incoming.status().name());
          saved.setPlayTicks(incoming.playTicks());
          saved.setJumps(incoming.jumps());
          saved.setFalls(incoming.falls());
          saved.setCurrentProgress(incoming.currentProgress());
          saved.setMaxProgress(incoming.maxProgress());
          saved.setPeakReachedTicks(incoming.peakReachedTicks());
          saved.setFinishTicks(incoming.finishTicks());
          saved.setEndedAt(incoming.endedAt());
          saved.setUpdatedAt(clock.instant());
          runs.saveAndFlush(saved);
          if (incoming.status() == SoloMetrics.Status.FINISHED) crowns.unlock(owner);
          return new Ack(incoming.revision(), "SAVED");
        });
  }
}
