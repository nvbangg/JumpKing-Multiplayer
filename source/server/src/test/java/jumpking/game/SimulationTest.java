package jumpking.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class SimulationTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final SharedData shared;
  private final Physics physics;
  private final GameMap map;

  SimulationTest() throws Exception {
    shared = new SharedData(mapper);
    physics =
        new Physics(
            mapper.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {}));
    map = mapper.treeToValue(shared.map(), GameMap.class);
  }

  private JsonNode fixture(String file) throws Exception {
    try (var stream = new ClassPathResource("fixtures/" + file).getInputStream()) {
      return mapper.readTree(stream);
    }
  }

  private void assertState(PlayerState actual, JsonNode expected, String context) {
    JsonNode json = mapper.valueToTree(actual);
    expected
        .properties()
        .forEach(
            field -> {
              JsonNode value = json.get(field.getKey());
              assertThat(value).as(context + "/" + field.getKey()).isNotNull();
              if (field.getValue().isNumber())
                assertThat(value.doubleValue())
                    .as(context + "/" + field.getKey())
                    .isEqualTo(field.getValue().doubleValue());
              else assertThat(value).as(context + "/" + field.getKey()).isEqualTo(field.getValue());
            });
    assertThat(json.size()).isEqualTo(expected.size());
  }

  @Test
  void matchesEveryTickOfIndependentFixtures() throws Exception {
    for (JsonNode trace : fixture("physics-traces.json").path("cases")) {
      var sim =
          new Simulation(
              mapper.treeToValue(trace.path("map"), GameMap.class), physics, false, false);
      sim.restore(mapper.treeToValue(trace.path("initial"), PlayerState.class));
      int tick = 0;
      for (JsonNode frame : trace.path("frames")) {
        sim.tick(mapper.treeToValue(frame.path("input"), PlayerInput.class));
        assertState(
            sim.snapshot(), frame.path("state"), trace.path("name").asText() + "/" + ++tick);
      }
    }
  }

  @Test
  void restoreAndReplayAreExactAndMalformedStateIsRejected() throws Exception {
    var sim = new Simulation(map, physics, false, false);
    for (int i = 0; i < 30; i++) sim.tick(PlayerInput.NEUTRAL);
    for (int i = 0; i < 12; i++) sim.tick(new PlayerInput(false, true, true));
    var replay = new Simulation(map, physics, false, false);
    replay.restore(mapper.readValue(mapper.writeValueAsBytes(sim.snapshot()), PlayerState.class));
    for (int i = 0; i < 200; i++) {
      var input = new PlayerInput(i < 2, false, i < 5);
      assertThat(replay.tick(input)).isEqualTo(sim.tick(input));
      assertState(replay.snapshot(), mapper.valueToTree(sim.snapshot()), "replay/" + i);
    }
    var invalid = sim.snapshot();
    invalid.x = Double.NaN;
    assertThatThrownBy(() -> sim.restore(invalid)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void completesTheFullMainBabeRouteWithoutCheats() throws Exception {
    var sim = new Simulation(map, physics, false, false);
    var visited = new HashSet<Integer>();
    var checkpoints = fixture("main-babe-checkpoints.json");
    int index = 0;
    for (int i = 0; i < 30; i++) step(sim, PlayerInput.NEUTRAL, visited);
    for (JsonNode action : fixture("main-babe-route.json")) {
      if (action.has("walk")) {
        for (int i = 0; i < action.path("ticks").asInt(); i++)
          step(
              sim,
              new PlayerInput(
                  action.path("walk").asInt() < 0, action.path("walk").asInt() > 0, false),
              visited);
      } else {
        step(sim, PlayerInput.NEUTRAL, visited);
        int charge = action.path("charge").asInt(), direction = action.path("direction").asInt();
        for (int i = 0; i < charge; i++)
          step(
              sim,
              new PlayerInput(charge == 36 && direction < 0, charge == 36 && direction > 0, true),
              visited);
        if (charge != 36) step(sim, new PlayerInput(direction < 0, direction > 0, false), visited);
        for (int i = 0; i < 180; i++) {
          step(sim, PlayerInput.NEUTRAL, visited);
          if (sim.snapshot().grounded && i > 0) break;
        }
      }
      assertState(sim.snapshot(), checkpoints.get(index), "route/" + index);
      if (index++ % 17 == 0) {
        var resumed = new Simulation(map, physics, false, false);
        resumed.restore(
            mapper.readValue(mapper.writeValueAsBytes(sim.snapshot()), PlayerState.class));
        sim = resumed;
      }
    }
    assertThat(visited).hasSize(43);
    assertThat(sim.snapshot().jumps).isEqualTo(228);
    assertThat(sim.snapshot().falls).isZero();
    assertThat(sim.finished()).isTrue();
    assertThat(sim.snapshot().ticks).isEqualTo(16957);
  }

  private void step(Simulation sim, PlayerInput input, HashSet<Integer> visited) {
    sim.tick(input);
    visited.add(sim.snapshot().screen);
  }
}
