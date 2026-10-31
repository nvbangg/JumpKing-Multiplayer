package jumpking.room;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
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
    var captured =
        PlayerSnapshot.capture(game, "player", "name", 2, "ACTIVE", jumpking.entity.Crown.BLACK);
    var before = json.valueToTree(captured);
    game.tick(new PlayerInput(false, true, true));
    var after = json.valueToTree(captured);
    assertThat(after).isEqualTo(before);
    assertThat(captured.ticks()).isZero();
    var view = json.valueToTree(SpectatorView.of(captured, "play", 0, false));
    assertThat(view.path("player").path("crown").asText()).isEqualTo("BLACK");
    assertThat(view.path("player").path("positionRevision").isIntegralNumber()).isTrue();
    assertThat(view.path("player").path("positionRevision").asLong()).isZero();
    assertThat(view.path("adventure"))
        .isEqualTo(json.valueToTree(captured.simulation().adventure()));
    assertThat(view.path("world")).isEqualTo(json.valueToTree(captured.simulation().world()));
    var pose = view.path("player").path("state");
    assertThat(pose.path("ticks").asLong()).isZero();
    assertThat(pose.has("prevJump")).isFalse();
    assertThat(pose.has("freeFlight")).isFalse();
    for (String field : List.of("jumps", "ice", "wind")) {
      assertThat(pose.has(field)).as(field).isFalse();
      assertThat(before.path("simulation").path("physics").has(field)).as(field).isTrue();
    }
    assertThat(view.has("simulation")).isFalse();
    assertThat(view.has("lastProcessedInputSeq")).isFalse();
  }

  @Test
  void sameScreenPhasingRespawnChangesPublicRevisionWithoutChangingFallsOrCheckpoint()
      throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var game =
        new GameSimulation(shared.geometry(), shared.tuning(), shared.adventure(), true, false);
    var pose = game.physics().snapshot();
    pose.x = 12;
    pose.y = shared.geometry().screenHeight() - shared.tuning().bodyHeight - 1;
    pose.vy = shared.tuning().maxFall;
    pose.grounded = false;
    pose.phasingFall = true;
    pose.ticks = 100;
    pose.jumps = 7;
    pose.falls = 2;
    game.physics().restore(pose);
    var before =
        PlayerSnapshot.capture(game, "player", "name", 0, "ACTIVE", jumpking.entity.Crown.NONE);
    game.tick(PlayerInput.NEUTRAL);
    var after =
        PlayerSnapshot.capture(game, "player", "name", 0, "ACTIVE", jumpking.entity.Crown.NONE);
    assertThat(before.player().positionRevision()).isZero();
    assertThat(after.player().positionRevision()).isEqualTo(1);
    assertThat(after.player().state().screen()).isEqualTo(before.player().state().screen());
    assertThat(after.player().state().falls()).isEqualTo(2);
    assertThat(after.player().state().ticks()).isEqualTo(101);
    assertThat(after.player().state().x()).isEqualTo(shared.geometry().spawn().x());
    assertThat(json.valueToTree(after.simulation()).has("positionRevision")).isFalse();
    assertThat(json.valueToTree(after.simulation().physics()).has("positionRevision")).isFalse();
    game.physics().respawnAt(shared.geometry().spawn().x(), shared.geometry().spawn().y());
    assertThat(game.physics().positionRevision()).isEqualTo(2);
    assertThat(after.player().positionRevision()).isEqualTo(1);
  }

  @Test
  void onlyRespawnsChangePublicPositionRevisionOnSplat() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    for (String mode : List.of("EASY", "HARDCORE", "RACE")) {
      var game =
          new GameSimulation(shared.geometry(), shared.tuning(), shared.adventure(), false, false);
      var pose = game.physics().snapshot();
      pose.x = 200;
      pose.y = 280;
      pose.vy = shared.tuning().maxFall;
      pose.grounded = false;
      pose.falls = 2;
      game.physics().restore(pose);
      boolean splat = false;
      for (int tick = 0; tick < 8 && !splat; tick++)
        splat = game.tick(PlayerInput.NEUTRAL, mode).movement().contains("SPLAT");
      assertThat(splat).as(mode).isTrue();
      var captured =
          PlayerSnapshot.capture(game, "player", "name", 0, "ACTIVE", jumpking.entity.Crown.NONE);
      assertThat(captured.player().positionRevision())
          .as(mode)
          .isEqualTo(mode.equals("RACE") ? 0 : 1);
      assertThat(captured.player().state().falls()).as(mode).isEqualTo(3);
    }
  }
}
