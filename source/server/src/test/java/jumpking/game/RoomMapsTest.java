package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class RoomMapsTest {
  @Test
  void allTenGoalsAreReachableFromTheNativeSpawnWithoutFlyOrSplat() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var physics =
        new Physics(
            json.convertValue(
                shared.physics(),
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Number>>() {}));
    com.fasterxml.jackson.databind.JsonNode route;
    try (var input = new ClassPathResource("fixtures/main-babe-route.json").getInputStream()) {
      route = json.readTree(input);
    }
    for (var goal : shared.roomMaps()) {
      var map = shared.roomMap(goal.level());
      var game = new GameSimulation(map, physics, shared.adventure(), false, false);
      java.util.function.Consumer<PlayerInput> step =
          input -> {
            if (!game.finished()) game.tick(input);
          };
      for (int i = 0; i < 30; i++) step.accept(PlayerInput.NEUTRAL);
      for (var action : route) {
        if (action.has("walk")) {
          for (int i = 0; i < action.path("ticks").asInt(); i++)
            step.accept(
                new PlayerInput(
                    action.path("walk").asInt() < 0, action.path("walk").asInt() > 0, false));
        } else {
          step.accept(PlayerInput.NEUTRAL);
          int charge = action.path("charge").asInt(), direction = action.path("direction").asInt();
          for (int i = 0; i < charge; i++)
            step.accept(
                new PlayerInput(
                    charge == 36 && direction < 0, charge == 36 && direction > 0, true));
          if (charge != 36) step.accept(new PlayerInput(direction < 0, direction > 0, false));
          for (int i = 0; i < 180; i++) {
            step.accept(PlayerInput.NEUTRAL);
            if (game.physics().snapshot().grounded && i > 0) break;
          }
        }
        if (game.finished()) break;
      }
      var state = game.physics().snapshot();
      assertThat(game.finished()).as("level %s", goal.level()).isTrue();
      assertThat(state.screen).isEqualTo(goal.finish().screen());
      assertThat(state.falls).isZero();
      assertThat(state.freeFlight).isFalse();
      assertThat(game.adventure().completed()).isEqualTo(goal.level() == 10);
      state.grounded = false;
      game.physics().restore(state);
      assertThat(game.finished()).isFalse();
    }
    assertThatThrownBy(() -> shared.roomMap(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> shared.roomMap(11)).isInstanceOf(IllegalArgumentException.class);
  }
}
