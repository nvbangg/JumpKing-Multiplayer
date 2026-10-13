package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class NoWalkTest {
  @Test
  void horizontalGroundInputOnlySelectsDirectionAndDoesNotChangeAirborneSteering()
      throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var game =
        new Simulation(
            json.treeToValue(shared.map(), GameMap.class),
            new Physics(
                json.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {})),
            false,
            true);
    for (int tick = 0; tick < 30; tick++) game.tick(PlayerInput.NEUTRAL);
    double start = game.snapshot().x;
    for (int tick = 0; tick < 20; tick++) game.tick(new PlayerInput(false, true, false));
    assertThat(game.snapshot().x).isEqualTo(start);
    assertThat(game.snapshot().vx).isZero();
    for (int tick = 0; tick < 36; tick++) game.tick(new PlayerInput(false, true, true));
    assertThat(game.snapshot().jumps).isEqualTo(1);
    assertThat(game.snapshot().vx).isEqualTo(3.5);
    game.tick(new PlayerInput(true, false, false));
    assertThat(game.snapshot().vx).isEqualTo(3.5);
    assertThat(game.snapshot().x).isGreaterThan(start);
  }

  @Test
  void airborneWallBounceMatchesIndependentNativeFixturesInBothDirections() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var physics =
        new Physics(
            json.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {}));
    try (var stream = new ClassPathResource("fixtures/physics-traces.json").getInputStream()) {
      for (var trace : json.readTree(stream).path("cases")) {
        if (!trace.path("name").asText().startsWith("wall-")) continue;
        var game =
            new Simulation(
                json.treeToValue(trace.path("map"), GameMap.class), physics, false, true);
        game.restore(json.treeToValue(trace.path("initial"), PlayerState.class));
        boolean bounced = false, airborne = false;
        var previousState = trace.path("initial");
        for (var frame : trace.path("frames")) {
          if (!airborne) {
            if (frame.path("state").path("grounded").asBoolean()) {
              previousState = frame.path("state");
              continue;
            }
            game.restore(json.treeToValue(previousState, PlayerState.class));
            airborne = true;
          }
          if (frame.path("state").path("grounded").asBoolean()) break;
          double previous = game.snapshot().vx;
          game.tick(json.treeToValue(frame.path("input"), PlayerInput.class));
          if (previous * game.snapshot().vx < 0) bounced = true;
          com.fasterxml.jackson.databind.JsonNode actual = json.valueToTree(game.snapshot());
          assertThat(actual.size()).isEqualTo(frame.path("state").size());
          for (var field : frame.path("state").properties()) {
            if (field.getValue().isNumber())
              assertThat(actual.path(field.getKey()).doubleValue())
                  .as(field.getKey())
                  .isEqualTo(field.getValue().doubleValue());
            else
              assertThat(actual.path(field.getKey()))
                  .as(field.getKey())
                  .isEqualTo(field.getValue());
          }
        }
        assertThat(bounced).as(trace.path("name").asText()).isTrue();
      }
    }
  }
}
