package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class NoWalkTest {
  private final Physics physics = new SharedData(new ObjectMapper()).tuning();

  NoWalkTest() throws Exception {}

  private Simulation ground(String tile) {
    var rows = new ArrayList<>(Collections.nCopies(44, " ".repeat(60)));
    rows.add(tile.repeat(60));
    var map =
        new GameMap(
            480,
            360,
            8,
            352,
            new GameMap.Spawn(231, 326),
            new GameMap.Finish(0, 0, true, 9999, null),
            List.of(new GameMap.Screen(rows, false)));
    var sim = new Simulation(map, physics, false, true);
    sim.tick(PlayerInput.NEUTRAL);
    return sim;
  }

  private void jumpAndLand(Simulation sim, int direction) {
    for (int i = 0; i < 12; i++) sim.tick(new PlayerInput(direction < 0, direction > 0, true));
    sim.tick(new PlayerInput(direction < 0, direction > 0, false));
    assertThat(sim.snapshot().vx).isEqualTo(direction * physics.jumpSpeed);
    sim.tick(new PlayerInput(direction > 0, direction < 0, false));
    assertThat(sim.snapshot().grounded).isFalse();
    assertThat(sim.snapshot().vx).isEqualTo(direction * physics.jumpSpeed);
    for (int i = 0; i < 120 && !sim.snapshot().grounded; i++) sim.tick(PlayerInput.NEUTRAL);
    assertThat(sim.snapshot().grounded).isTrue();
    assertThat(sim.snapshot().falls).isZero();
  }

  @Test
  void horizontalJumpsStopOnOrdinaryGroundDespiteIdleOrDirectionalInput() {
    for (int direction : new int[] {-1, 1}) {
      var sim = ground("#");
      double startX = sim.snapshot().x;
      for (int i = 0; i < 20; i++) sim.tick(new PlayerInput(direction < 0, direction > 0, false));
      assertThat(sim.snapshot().x).isEqualTo(startX);
      assertThat(sim.snapshot().vx).isZero();
      jumpAndLand(sim, direction);
      assertThat(sim.snapshot().vx).isZero();
      double landedX = sim.snapshot().x;
      for (int intent : new int[] {-1, 0, 1}) {
        for (int i = 0; i < 20; i++) sim.tick(new PlayerInput(intent < 0, intent > 0, false));
        assertThat(sim.snapshot().vx).isZero();
        assertThat(sim.snapshot().x).isEqualTo(landedX);
      }
    }
  }

  @Test
  void landingOnIceRetainsFrictionWithoutAllowingWalkingIntentToSteer() {
    for (int direction : new int[] {-1, 1}) {
      var sim = ground("I");
      jumpAndLand(sim, direction);
      var landed = sim.snapshot();
      assertThat(landed.ice).isTrue();
      assertThat(landed.vx * direction).isPositive().isLessThan(physics.jumpSpeed);
      sim.tick(new PlayerInput(direction > 0, direction < 0, false));
      assertThat(sim.snapshot().x).isCloseTo(landed.x + landed.vx, within(0.0001));
      assertThat(sim.snapshot().vx * direction)
          .isCloseTo(landed.vx * direction - physics.iceFriction, within(0.0001));
    }
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
