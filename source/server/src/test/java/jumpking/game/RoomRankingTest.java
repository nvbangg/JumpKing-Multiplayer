package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class RoomRankingTest {
  private RoomRanking.Score score(
      String id, String status, double current, double peak, Long finish) {
    return new RoomRanking.Score(id, id, status, current, peak, finish);
  }

  @Test
  void liveCommunityUsesOnlyCurrentHeightAndRoomRetainsItsModeComparator() {
    var scores =
        List.of(
            score("b", "ACTIVE", 20, 50, null),
            score("a", "ACTIVE", 20, 40, null),
            score("c", "FINISHED", 10, 100, 600L));
    var height = RoomRanking.currentHeight(scores);
    assertThat(height).extracting(row -> row.score().playerId()).containsExactly("a", "b", "c");
    assertThat(height).extracting(RoomRanking.Ranked::rank).containsExactly(1, 1, 3);
    assertThat(height).noneMatch(RoomRanking.Ranked::winner);
    assertThat(RoomRanking.rank(scores, "TIME_LIMIT", false))
        .extracting(row -> row.score().playerId())
        .containsExactly("c", "b", "a");
  }

  @Test
  void finishesWinAtTheSameTickAndTiesAreNotBrokenByIdentifiers() {
    var scores =
        List.of(
            score("z", "FINISHED", 100, 100, 600L),
            score("a", "FINISHED", 100, 100, 600L),
            score("b", "UNFINISHED", 99, 100, null),
            score("c", "DNF", 99, 100, null));
    for (String mode : List.of("RACE", "HARDCORE", "TIME_LIMIT", "NO_WALK")) {
      var ranked = RoomRanking.rank(scores, mode, true);
      assertThat(ranked).extracting(RoomRanking.Ranked::rank).containsExactly(1, 1, 3, 3);
      assertThat(ranked)
          .extracting(RoomRanking.Ranked::winner)
          .containsExactly(true, true, false, false);
      assertThat(RoomRanking.rank(scores, mode, false)).noneMatch(RoomRanking.Ranked::winner);
    }
  }

  @Test
  void onlyTimeLimitUsesPastPeakAfterCurrentHeightAndUnfinishedLeadersDoNotWin() {
    var scores =
        List.of(
            score("a", "UNFINISHED", 10.125, 100, null),
            score("b", "UNFINISHED", 10.125, 90, null),
            score("c", "DNF", 10.124, 150, null));
    assertThat(RoomRanking.rank(scores, "RACE", true))
        .extracting(RoomRanking.Ranked::rank)
        .containsExactly(1, 1, 3);
    assertThat(RoomRanking.rank(scores, "TIME_LIMIT", true))
        .extracting(RoomRanking.Ranked::rank)
        .containsExactly(1, 2, 3);
    assertThat(RoomRanking.rank(scores, "TIME_LIMIT", true)).noneMatch(RoomRanking.Ranked::winner);
    assertThatThrownBy(() -> score("bad", "FINISHED", 0, 0, null))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
