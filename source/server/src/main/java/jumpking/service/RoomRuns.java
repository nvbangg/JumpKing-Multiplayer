package jumpking.service;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import jumpking.entity.PlayRun;
import jumpking.exception.ApiException;
import jumpking.game.RoomRanking;
import jumpking.repository.MatchRepository;
import jumpking.repository.PlayRunRepository;
import org.springframework.stereotype.Service;

/** Một bản ghi tích lũy của toàn roster; match và metrics được commit cùng transaction. */
@Service
public class RoomRuns {
  public record Run(
      String id,
      long owner,
      String nickname,
      String status,
      long ticks,
      int jumps,
      int falls,
      double progress,
      double maximum,
      long peak,
      Long finish,
      Integer rank,
      boolean winner,
      Instant endedAt) {
    public Run {
      endedAt = millis(endedAt);
    }

    Run unranked() {
      return new Run(
          id, owner, nickname, status, ticks, jumps, falls, progress, maximum, peak, finish, null,
          false, endedAt);
    }
  }

  public record Write(
      String id,
      String roomCode,
      String mode,
      Integer minutes,
      int mapLevel,
      long revision,
      Instant startedAt,
      Instant endedAt,
      long duration,
      String reason,
      List<Run> runs) {
    public Write {
      startedAt = millis(startedAt);
      endedAt = millis(endedAt);
      runs = List.copyOf(runs);
    }
  }

  private record Match(
      String roomCode,
      String mode,
      Integer minutes,
      int mapLevel,
      Instant startedAt,
      Instant endedAt,
      long duration,
      String reason) {}

  private record Stored(Run run, long revision) {}

  private final MatchRepository matchRepository;
  private final PlayRunRepository runRepository;
  private final RunOwners owners;
  private final CrownService crowns;
  private final Clock clock;
  private final int capacity;

  public RoomRuns(
      MatchRepository matchRepository,
      PlayRunRepository runRepository,
      RunOwners owners,
      CrownService crowns,
      Clock clock,
      jumpking.game.SharedData shared) {
    this.matchRepository = matchRepository;
    this.runRepository = runRepository;
    this.owners = owners;
    this.crowns = crowns;
    this.clock = clock;
    capacity = shared.rules().path("capacity").asInt();
  }

  public void save(Write write) {
    validate(write);
    owners.writeAll(
        write.runs.stream().map(Run::owner).toList(),
        () -> {
          var next = write.runs;
          var matchEntity = matchRepository.lockById(write.id).orElse(null);
          var previous = matchEntity == null ? null : matchView(matchEntity);
          var entities = runRepository.lockByMatchId(write.id);
          var old = stored(entities);
          var desired =
              new Match(
                  write.roomCode,
                  write.mode,
                  write.minutes,
                  write.mapLevel,
                  write.startedAt,
                  write.endedAt,
                  write.duration,
                  write.reason);
          if (previous != null) {
            if (!previous.roomCode.equals(write.roomCode)
                || !previous.mode.equals(write.mode)
                || !Objects.equals(previous.minutes, write.minutes)
                || previous.mapLevel != write.mapLevel
                || !previous.startedAt.equals(write.startedAt)
                || old.size() != next.size()) throw conflict();
            var byId = new HashMap<String, Stored>();
            old.forEach(value -> byId.put(value.run.id, value));
            for (var run : next) {
              var value = byId.get(run.id);
              if (value == null
                  || value.run.owner != run.owner
                  || !value.run.nickname.equals(run.nickname)) throw conflict();
            }
            long revision = old.stream().mapToLong(Stored::revision).max().orElseThrow();
            if (write.revision < revision) return null;
            if (write.revision == revision) {
              if (!previous.equals(desired)
                  || next.stream().anyMatch(run -> !byId.get(run.id).run.equals(run)))
                throw conflict();
              return null;
            }
            if (previous.endedAt != null || write.duration < previous.duration) throw conflict();
            for (var run : next) {
              var before = byId.get(run.id).run;
              if (!before.status.equals("ACTIVE") && !before.unranked().equals(run.unranked()))
                throw conflict();
              if (run.ticks < before.ticks
                  || run.jumps < before.jumps
                  || run.falls < before.falls
                  || run.maximum < before.maximum
                  || run.peak < before.peak
                  || run.maximum == before.maximum && run.peak != before.peak) throw conflict();
            }
          } else {
            if (!old.isEmpty()) throw conflict();
            matchEntity = new jumpking.entity.Match();
            matchEntity.setId(write.id);
            matchEntity.setRoomCode(write.roomCode);
            matchEntity.setMode(write.mode);
            matchEntity.setMapLevel(write.mapLevel);
            matchEntity.setTimeLimitMinutes(write.minutes);
            matchEntity.setStartedAt(write.startedAt);
            matchEntity = matchRepository.saveAndFlush(matchEntity);
          }
          matchEntity.setDurationTicks(write.duration);
          matchEntity.setEndedAt(write.endedAt);
          matchEntity.setEndReason(write.reason);
          var byId = new HashMap<String, PlayRun>();
          entities.forEach(run -> byId.put(run.getId(), run));
          for (var run : next) {
            var entity = byId.get(run.id);
            if (entity == null) {
              entity = new PlayRun();
              entity.setId(run.id);
              entity.setUserId(run.owner);
              entity.setKind("ROOM");
              entity.setMatchId(write.id);
              entity.setNickname(run.nickname);
              entity.setStartedAt(write.startedAt);
            }
            entity.setRevision(write.revision);
            entity.setStatus(run.status);
            entity.setPlayTicks(run.ticks);
            entity.setJumps(run.jumps);
            entity.setFalls(run.falls);
            entity.setCurrentProgress(run.progress);
            entity.setMaxProgress(run.maximum);
            entity.setPeakReachedTicks(run.peak);
            entity.setFinishTicks(run.finish);
            entity.setRank(run.rank);
            entity.setWinner(run.winner);
            if (run.status.equals("FINISHED") && write.mapLevel == 10) crowns.unlock(run.owner);
            entity.setEndedAt(run.endedAt);
            entity.setUpdatedAt(clock.instant());
            runRepository.save(entity);
          }
          runRepository.flush();
          return null;
        });
  }

  /** Chỉ gọi lúc khởi động, trước khi nhận gameplay mới; không phục hồi Room từ metrics. */
  public void recoverAborted() {
    for (var entity : matchRepository.findByEndedAtIsNullOrderById()) {
      String id = entity.getId();
      var match = matchView(entity);
      var stored = stored(runRepository.findByMatchId(id));
      var ended = millis(clock.instant());
      if (ended.isBefore(match.startedAt)) ended = match.startedAt;
      for (var value : stored)
        if (value.run.endedAt != null && value.run.endedAt.isAfter(ended))
          ended = value.run.endedAt;
      final Instant deadline = ended;
      var scores =
          stored.stream()
              .map(
                  value -> {
                    var run = value.run;
                    return new RoomRanking.Score(
                        run.id, run.nickname, "DNF", run.progress, run.maximum, null);
                  })
              .toList();
      var ranks = RoomRanking.rank(scores, match.mode, false);
      var abandoned =
          stored.stream()
              .map(
                  value -> {
                    var run = value.run;
                    int rank =
                        ranks.stream()
                            .filter(row -> row.score().playerId().equals(run.id))
                            .findFirst()
                            .orElseThrow()
                            .rank();
                    return new Run(
                        run.id,
                        run.owner,
                        run.nickname,
                        "DNF",
                        run.ticks,
                        run.jumps,
                        run.falls,
                        run.progress,
                        run.maximum,
                        run.peak,
                        null,
                        rank,
                        false,
                        run.endedAt == null ? deadline : run.endedAt);
                  })
              .toList();
      save(
          new Write(
              id,
              match.roomCode,
              match.mode,
              match.minutes,
              match.mapLevel,
              stored.stream().mapToLong(Stored::revision).max().orElseThrow() + 1,
              match.startedAt,
              deadline,
              match.duration,
              "ABORTED",
              abandoned));
    }
  }

  private static Match matchView(jumpking.entity.Match match) {
    return new Match(
        match.getRoomCode(),
        match.getMode(),
        match.getTimeLimitMinutes(),
        match.getMapLevel(),
        match.getStartedAt(),
        match.getEndedAt(),
        match.getDurationTicks(),
        match.getEndReason());
  }

  private static List<Stored> stored(List<PlayRun> runs) {
    return runs.stream()
        .map(
            run ->
                new Stored(
                    new Run(
                        run.getId(),
                        run.getUserId(),
                        run.getNickname(),
                        run.getStatus(),
                        run.getPlayTicks(),
                        run.getJumps(),
                        run.getFalls(),
                        run.getCurrentProgress(),
                        run.getMaxProgress(),
                        run.getPeakReachedTicks(),
                        run.getFinishTicks(),
                        run.getRank(),
                        run.getWinner(),
                        run.getEndedAt()),
                    run.getRevision()))
        .toList();
  }

  private void validate(Write value) {
    if (value.mapLevel < 1
        || value.mapLevel > 10
        || value.revision < 1
        || value.duration < 0
        || value.startedAt == null
        || value.runs.isEmpty()
        || value.runs.size() > capacity
        || (value.endedAt == null) != (value.reason == null)
        || value.endedAt != null && value.endedAt.isBefore(value.startedAt)) throw conflict();
    var ids = new HashSet<String>();
    for (var run : value.runs) {
      if (!ids.add(run.id)
          || !Set.of("ACTIVE", "FINISHED", "UNFINISHED", "DNF").contains(run.status)
          || run.ticks < 0
          || run.ticks > value.duration
          || run.jumps < 0
          || run.falls < 0
          || !Double.isFinite(run.progress)
          || !Double.isFinite(run.maximum)
          || run.progress < 0
          || run.maximum < run.progress
          || run.peak < 0
          || run.peak > run.ticks
          || run.status.equals("FINISHED") != (run.finish != null)
          || run.finish != null && (run.finish < 0 || run.finish > value.duration)
          || run.status.equals("ACTIVE") != (run.endedAt == null)
          || run.endedAt != null
              && (run.endedAt.isBefore(value.startedAt)
                  || value.endedAt != null && run.endedAt.isAfter(value.endedAt))) throw conflict();
      if (value.endedAt == null
          && (run.rank != null
              || run.winner
              || run.status.equals("FINISHED")
              || run.status.equals("UNFINISHED"))) throw conflict();
      if (value.endedAt != null && run.status.equals("ACTIVE")) throw conflict();
    }
    if (value.endedAt != null) {
      var scores =
          value.runs.stream()
              .map(
                  run ->
                      new RoomRanking.Score(
                          run.id, run.nickname, run.status, run.progress, run.maximum, run.finish))
              .toList();
      var ranks = RoomRanking.rank(scores, value.mode, value.reason.equals("FINISH"));
      for (var run : value.runs) {
        var ranked =
            ranks.stream()
                .filter(row -> row.score().playerId().equals(run.id))
                .findFirst()
                .orElseThrow();
        if (!Objects.equals(run.rank, ranked.rank()) || run.winner != ranked.winner())
          throw conflict();
      }
      if (value.reason.equals("FINISH") && ranks.stream().noneMatch(RoomRanking.Ranked::winner))
        throw conflict();
    }
  }

  private static Instant millis(Instant time) {
    return time == null ? null : time.truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
  }

  private static ApiException conflict() {
    return new ApiException(409, "CONFLICT", "Room results conflict with the committed match");
  }
}
