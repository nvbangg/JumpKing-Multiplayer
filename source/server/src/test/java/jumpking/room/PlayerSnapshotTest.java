package jumpking.room;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import jumpking.game.GameSimulation;
import jumpking.game.PlayerInput;
import jumpking.game.SharedData;
import org.junit.jupiter.api.Test;

class PlayerSnapshotTest {
  @Test
  void captureSurvivesFurtherTicksAndSpectatorDoesNotReceivePrivatePhysics() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var game =
        new GameSimulation(shared.geometry(), shared.tuning(), shared.adventure(), false, false);
    var captured = PlayerSnapshot.capture(game, "player", "name", 2, "ACTIVE");
    var before = json.valueToTree(captured);
    game.tick(new PlayerInput(false, true, true));
    var after = json.valueToTree(captured);
    assertThat(after).isEqualTo(before);
    assertThat(captured.ticks()).isZero();
    var view = json.valueToTree(SpectatorView.of(captured, "play", 0, false));
    assertThat(view.path("adventure"))
        .isEqualTo(json.valueToTree(captured.simulation().adventure()));
    assertThat(view.path("world")).isEqualTo(json.valueToTree(captured.simulation().world()));
    var pose = view.path("player").path("state");
    assertThat(pose.path("ticks").asLong()).isZero();
    assertThat(pose.has("prevJump")).isFalse();
    assertThat(pose.has("freeFlight")).isFalse();
    assertThat(view.has("simulation")).isFalse();
    assertThat(view.has("lastProcessedInputSeq")).isFalse();
  }
}
