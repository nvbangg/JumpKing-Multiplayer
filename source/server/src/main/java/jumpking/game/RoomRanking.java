package jumpking.game;

import java.util.*;

/** Comparator không dùng ID để phá đồng hạng; người chưa Finish dùng cùng clock trận. */
public final class RoomRanking {
  private static final Set<String> STATUSES = Set.of("ACTIVE", "FINISHED", "UNFINISHED", "DNF");

  private RoomRanking() {}

  public record Score(
      String playerId,
      String status,
      double currentProgress,
      double maxProgress,
      Long finishTicks) {
    public Score {
      if (!STATUSES.contains(status)
          || !Double.isFinite(currentProgress)
          || !Double.isFinite(maxProgress)
          || currentProgress < 0
          || maxProgress < currentProgress
          || (status.equals("FINISHED") != (finishTicks != null))
          || finishTicks != null && finishTicks < 0)
        throw new IllegalArgumentException("Invalid Room score");
    }
  }

  public record Ranked(Score score, int rank) {}

  public static List<Ranked> rank(List<Score> scores, boolean hasTimeLimit) {
    Comparator<Score> comparator =
        (a, b) -> {
          if (a.finishTicks != null || b.finishTicks != null) {
            if (a.finishTicks == null) return 1;
            if (b.finishTicks == null) return -1;
            return Long.compare(a.finishTicks, b.finishTicks);
          }
          int progress = Double.compare(b.currentProgress, a.currentProgress);
          return progress != 0 || !hasTimeLimit
              ? progress
              : Double.compare(b.maxProgress, a.maxProgress);
        };
    return order(scores, comparator);
  }

  public static List<Ranked> currentHeight(List<Score> scores) {
    return order(scores, Comparator.comparingDouble(Score::currentProgress).reversed());
  }

  private static List<Ranked> order(List<Score> scores, Comparator<Score> comparator) {
    var sorted = scores.stream().sorted(comparator.thenComparing(Score::playerId)).toList();
    var result = new ArrayList<Ranked>();
    int rank = 0;
    for (int index = 0; index < sorted.size(); index++) {
      var score = sorted.get(index);
      if (index == 0 || comparator.compare(sorted.get(index - 1), score) != 0) rank = index + 1;
      result.add(new Ranked(score, rank));
    }
    return List.copyOf(result);
  }
}
