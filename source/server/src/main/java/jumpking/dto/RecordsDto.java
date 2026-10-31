package jumpking.dto;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;

public final class RecordsDto {
  private RecordsDto() {}

  public record Profile(String username, Statistics total) {}

  public record Statistics(
      BigInteger totalPlayTimeMs,
      long totalJumps,
      long totalFalls,
      long finishes,
      long matchesPlayed,
      long roomWins,
      Long bestFinishTimeMs) {}

  public record Room(String mode, int mapId, Integer itemCooldownMinutes, Integer rank) {}

  public record History(
      String id,
      String kind,
      Instant startedAt,
      Instant endedAt,
      String status,
      long playTimeMs,
      int jumps,
      int falls,
      double currentProgress,
      double maxProgress,
      Long finishTimeMs,
      Room room) {}

  public record Page(List<History> items, int page, int size, boolean hasNext) {}

  public record Participant(
      String runId,
      String username,
      String status,
      Integer rank,
      double currentProgress,
      double maxProgress,
      Long finishTimeMs,
      long playTimeMs,
      int jumps,
      int falls) {}

  public record LeaderboardEntry(
      String id,
      long rank,
      String username,
      String status,
      double currentProgress,
      double maxProgress,
      long elapsedTimeMs,
      long peakReachedTimeMs,
      Long finishTimeMs) {}
}
