package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import jumpking.support.MainBabeRoute;
import org.junit.jupiter.api.Test;

class HardcoreTest {
  private final ObjectMapper json = new ObjectMapper();
  private final SharedData shared;
  private final GameMap map;
  private final Physics physics;

  HardcoreTest() throws Exception {
    shared = new SharedData(json);
    map = json.treeToValue(shared.map(), GameMap.class);
    physics =
        new Physics(
            json.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {}));
  }

  private GameSimulation game() {
    return new GameSimulation(map, physics, shared.adventure(), false, false);
  }

  @Test
  void splatRespawnsTheBodyButKeepsCountersAndAdventure() {
    var game = game();
    var pose = game.physics().snapshot();
    pose.y = 280;
    pose.vy = 10;
    pose.grounded = false;
    pose.ticks = 500;
    pose.jumps = 12;
    pose.falls = 2;
    game.physics().restore(pose);
    boolean splat = false;
    for (int tick = 0; tick < 8 && !splat; tick++)
      splat = game.tick(PlayerInput.NEUTRAL, true).movement().contains("SPLAT");
    assertThat(splat).isTrue();
    var reset = game.snapshot();
    assertThat(reset.physics().x).isEqualTo(map.spawn().x());
    assertThat(reset.physics().y).isEqualTo(map.spawn().y());
    assertThat(reset.physics().ticks).isGreaterThan(500);
    assertThat(reset.world().path("lastTick").asLong()).isEqualTo(reset.physics().ticks);
    assertThat(reset.physics().jumps).isEqualTo(12);
    assertThat(reset.physics().falls).isEqualTo(3);
    assertThat(reset.physics().splat).isZero();
  }

  @Test
  void splattingOnTheFinishPlatformCannotGrantFinishOrItsRewardBeforeRespawn() throws Exception {
    var before = MainBabeRoute.beforeFinish(shared, json);
    var pose = before.physics();
    pose.vy = 10;
    pose.grounded = false;
    pose.splat = 0;
    pose.knocked = false;
    var race = game();
    race.restore(before);
    var hardcore = game();
    hardcore.restore(before);
    assertThat(race.tick(PlayerInput.NEUTRAL).movement()).contains("SPLAT");
    assertThat(race.finished()).isTrue();
    assertThat(hardcore.tick(PlayerInput.NEUTRAL, true).movement()).contains("SPLAT");
    assertThat(hardcore.finished()).isFalse();
    assertThat(hardcore.adventure().completed()).isFalse();
  }
}
