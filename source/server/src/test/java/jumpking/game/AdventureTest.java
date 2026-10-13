package jumpking.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.core.io.ClassPathResource;

class AdventureTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final SharedData shared;
  private final GameMap map;
  private final Physics physics;

  AdventureTest() throws Exception {
    shared = new SharedData(mapper);
    map = mapper.treeToValue(shared.map(), GameMap.class);
    physics =
        new Physics(
            mapper.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {}));
  }

  private JsonNode fixture(String file) throws Exception {
    try (var input = new ClassPathResource("fixtures/" + file).getInputStream()) {
      return mapper.readTree(input);
    }
  }

  private Adventure adventure() {
    return new Adventure(shared.adventure(), map, physics);
  }

  private void assertJson(JsonNode actual, JsonNode expected, String context) {
    assertThat(actual).as(context).isNotNull();
    if (expected.isNumber())
      assertThat(actual.doubleValue()).as(context).isEqualTo(expected.doubleValue());
    else if (expected.isObject()) {
      assertThat(actual.size()).as(context + "/keys").isEqualTo(expected.size());
      expected
          .properties()
          .forEach(
              entry ->
                  assertJson(
                      actual.get(entry.getKey()),
                      entry.getValue(),
                      context + "/" + entry.getKey()));
    } else if (expected.isArray()) {
      assertThat(actual.size()).as(context + "/size").isEqualTo(expected.size());
      for (int i = 0; i < expected.size(); i++)
        assertJson(actual.get(i), expected.get(i), context + "/" + i);
    } else assertThat(actual).as(context).isEqualTo(expected);
  }

  private ObjectNode projection(Adventure adventure) {
    var state = adventure.snapshot();
    state.remove("codecVersion");
    var readables = (ObjectNode) state.path("readables");
    var remove = new java.util.ArrayList<String>();
    readables
        .properties()
        .forEach(
            entry -> {
              if (entry.getValue().path("wait").asInt() == 0
                  && !entry.getValue().path("done").asBoolean()) remove.add(entry.getKey());
            });
    readables.remove(remove);
    state
        .path("dialogue")
        .properties()
        .forEach(
            entry -> {
              var speaker = (ObjectNode) entry.getValue();
              speaker.set(
                  "quoteLengths",
                  adventure.quoteLengths(
                      entry.getKey(),
                      speaker.path("quote").isNull() ? null : speaker.path("quote").asText()));
              var pool = speaker.putArray("poolLengths");
              for (JsonNode quote : speaker.path("pool"))
                pool.add(adventure.quoteLengths(entry.getKey(), quote.asText()));
              speaker.remove(List.of("quote", "pool"));
            });
    return state;
  }

  @TestFactory
  Stream<DynamicTest> matchesIndependentAdventureCheckpoints() throws Exception {
    return StreamSupport.stream(fixture("adventure-traces.json").path("cases").spliterator(), false)
        .map(
            trace ->
                DynamicTest.dynamicTest(
                    trace.path("name").asText(),
                    () -> {
                      var adventure = adventure();
                      var player = new Simulation(map, physics, false, false).snapshot();
                      int index = 0;
                      for (JsonNode step : trace.path("steps")) {
                        if (step.path("operation").asText().equals("COMPLETE"))
                          adventure.complete();
                        else {
                          player.x = step.path("player").path("x").asDouble();
                          player.y = step.path("player").path("y").asDouble();
                          player.screen = step.path("player").path("screen").asInt();
                          var input = mapper.treeToValue(step.path("input"), PlayerInput.class);
                          for (int i = 0; i < step.path("ticks").asInt(); i++) {
                            player.ticks++;
                            adventure.tick(player, input);
                          }
                        }
                        assertJson(
                            projection(adventure),
                            step.path("expected"),
                            trace.path("name").asText() + "/" + index++);
                        var restored = adventure();
                        restored.restore(adventure.snapshot());
                        adventure = restored;
                      }
                    }));
  }

  @Test
  void restoresDialogueAtomicallyAndMigratesLegacyItemState() {
    var adventure = adventure();
    adventure.complete();
    var saved = adventure.snapshot();
    assertThat(adventure.completed()).isTrue();
    var invalidCounters = saved.deepCopy();
    ((ObjectNode) invalidCounters.path("dialogue").path("old_man")).put("ticks", -1);
    assertThatThrownBy(() -> adventure.restore(invalidCounters))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
    var invalidFlags = saved.deepCopy();
    invalidFlags.putArray("flags").add("UnknownFlag");
    assertThatThrownBy(() -> adventure.restore(invalidFlags))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
    var legacy = saved.deepCopy();
    legacy.put("codecVersion", 1);
    legacy.withArray("flags").add("CHASE_BIRD_PAST_SNOWSTORM");
    legacy.putObject("inventory").put("Cap", 1);
    legacy.putArray("equipped").add("Cap");
    legacy.putArray("collected");
    legacy.putObject("birds");
    legacy.putObject("merchants");
    adventure.restore(legacy);
    assertThat(adventure.snapshot()).isEqualTo(saved);
  }

  @Test
  void fullGameKeepsPhysicsOracleAndRestoresWorldAndAdventure() throws Exception {
    var game = new GameSimulation(map, physics, shared.adventure(), false, false);
    for (int i = 0; i < 30; i++) game.tick(PlayerInput.NEUTRAL);
    var expected = fixture("main-babe-checkpoints.json");
    int index = 0;
    for (JsonNode action : fixture("main-babe-route.json")) {
      int direction = action.path("direction").asInt(), charge = action.path("charge").asInt();
      if (action.has("walk"))
        for (int i = 0; i < action.path("ticks").asInt(); i++)
          game.tick(
              new PlayerInput(
                  action.path("walk").asInt() < 0, action.path("walk").asInt() > 0, false));
      else {
        game.tick(PlayerInput.NEUTRAL);
        for (int i = 0; i < charge; i++)
          game.tick(
              new PlayerInput(charge == 36 && direction < 0, charge == 36 && direction > 0, true));
        if (charge != 36) game.tick(new PlayerInput(direction < 0, direction > 0, false));
        for (int i = 0; i < 180; i++) {
          game.tick(PlayerInput.NEUTRAL);
          if (game.physics().snapshot().grounded && i > 0) break;
        }
      }
      assertJson(
          mapper.valueToTree(game.physics().snapshot()), expected.get(index), "full game/" + index);
      if (index++ % 17 == 0)
        game.restore(
            mapper.readValue(
                mapper.writeValueAsBytes(game.snapshot()), GameSimulation.Snapshot.class));
    }
    assertThat(game.finished()).isTrue();
    assertThat(game.adventure().completed()).isTrue();
    assertThat(game.snapshot().world().path("registeredScreens").size()).isEqualTo(43);
    var saved = game.snapshot();
    var invalid = (ObjectNode) saved.world().deepCopy();
    invalid.put("lastTick", saved.physics().ticks + 1);
    assertThatThrownBy(
            () ->
                game.restore(
                    new GameSimulation.Snapshot(1, saved.physics(), saved.adventure(), invalid)))
        .isInstanceOf(IllegalArgumentException.class);
    assertJson(mapper.valueToTree(game.snapshot()), mapper.valueToTree(saved), "atomic restore");
  }
}
