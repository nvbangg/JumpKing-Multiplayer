package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class RoomRankingTest {
  private RoomRanking.Score score(
      String id, String status, double current, double peak, Long finish) {
    return new RoomRanking.Score(id, status, current, peak, finish);
  }

  @Test
  void liveCommunityUsesOnlyCurrentHeightAndRoomUsesFinishTimeThenCurrentHeight() {
    var scores =
        List.of(
            score("b", "ACTIVE", 20, 50, null),
            score("a", "ACTIVE", 20, 40, null),
            score("c", "FINISHED", 10, 100, 600L));
    var height = RoomRanking.currentHeight(scores);
    assertThat(height).extracting(row -> row.score().playerId()).containsExactly("a", "b", "c");
    assertThat(height).extracting(RoomRanking.Ranked::rank).containsExactly(1, 1, 3);
    assertThat(RoomRanking.rank(scores, false))
        .extracting(row -> row.score().playerId())
        .containsExactly("c", "a", "b");
    assertThat(RoomRanking.rank(scores, true))
        .extracting(row -> row.score().playerId())
        .containsExactly("c", "b", "a");
  }

  @Test
  void equalFinishTimesAndProgressReceiveSharedRanks() {
    var scores =
        List.of(
            score("z", "FINISHED", 100, 100, 600L),
            score("a", "FINISHED", 100, 100, 600L),
            score("b", "UNFINISHED", 99, 100, null),
            score("c", "DNF", 99, 100, null));
    for (boolean limited : List.of(false, true)) {
      var ranked = RoomRanking.rank(scores, limited);
      assertThat(ranked).extracting(RoomRanking.Ranked::rank).containsExactly(1, 1, 3, 3);
      assertThat(ranked).allSatisfy(row -> assertThat(row.rank()).isBetween(1, scores.size()));
    }
  }

  @Test
  void onlyLimitedMatchesUsePastPeakAfterCurrentHeight() {
    var scores =
        List.of(
            score("a", "UNFINISHED", 10.125, 100, null),
            score("b", "UNFINISHED", 10.125, 90, null),
            score("c", "DNF", 10.124, 150, null));
    assertThat(RoomRanking.rank(scores, false))
        .extracting(RoomRanking.Ranked::rank)
        .containsExactly(1, 1, 3);
    assertThat(RoomRanking.rank(scores, true))
        .extracting(RoomRanking.Ranked::rank)
        .containsExactly(1, 2, 3);
    assertThatThrownBy(() -> score("bad", "FINISHED", 0, 0, null))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
