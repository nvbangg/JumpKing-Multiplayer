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

  @Test
  void roomBirdsStartAtConfiguredPerchesWithinTheStageAndKeepTheirStateAfterRestore() {
    var expectedPerches =
        Map.of(
            "raven", List.of(0, 1, 2, 3, 4, 9, 12, -1, -1, -1),
            "whiteRaven", List.of(0, 3, 5, 9, 13, -1, -1, -1, -1, -1));
    for (int level = 1; level <= 10; level++) {
      var stage = shared.roomMap(level);
      var adventure = new Adventure(shared.adventure(), stage, physics);
      for (String bird : List.of("raven", "whiteRaven")) {
        int expected = expectedPerches.get(bird).get(level - 1);
        var state = adventure.snapshot().path(bird);
        assertThat(state.path("done").asBoolean()).isEqualTo(expected == -1);
        if (expected != -1) assertThat(state.path("index").asInt()).isEqualTo(expected);
      }
      var restored = new Adventure(shared.adventure(), stage, physics);
      restored.restore(adventure.snapshot());
      assertThat(restored.snapshot()).isEqualTo(adventure.snapshot());
    }
  }

  @Test
  void ravenRequiresTheSameScreenAndStrictlyLessThanFortyPixels() {
    var adventure = adventure();
    var player = new Simulation(map, physics, false, false).snapshot();
    player.screen = 2;
    player.x = 65;
    player.y = 88 - 720 - 13;
    assertThat(adventure.tick(player, PlayerInput.NEUTRAL))
        .doesNotContain(new Adventure.Event("FLEE", "raven"));
    player.screen = 3;
    player.x = 25;
    assertThat(adventure.tick(player, PlayerInput.NEUTRAL))
        .doesNotContain(new Adventure.Event("FLEE", "raven"));
    player.screen = 2;
    player.x = 64;
    assertThat(adventure.tick(player, PlayerInput.NEUTRAL))
        .contains(new Adventure.Event("FLEE", "raven"));
  }

  @Test
  void ravenFollowsEveryPerchAndResumesMidFlightIndependently() throws Exception {
    var adventure = adventure();
    var other = adventure();
    int flees = 0;
    for (var leg : fixture("raven-trace.json").path("legs")) {
      var player = new Simulation(map, physics, false, false).snapshot();
      player.x = leg.path("player").path("x").asDouble();
      player.y = leg.path("player").path("y").asDouble();
      player.screen = leg.path("player").path("screen").asInt();
      for (int tick = 1; tick <= leg.path("ticks").asInt(); tick++) {
        boolean flee =
            adventure.tick(player, PlayerInput.NEUTRAL).stream()
                .anyMatch(event -> event.type().equals("FLEE"));
        if (flee) flees++;
        for (var sample : leg.path("samples"))
          if (sample.path("tick").asInt() == tick) {
            assertJson(adventure.snapshot().path("raven"), sample.path("state"), "raven/" + tick);
            assertThat(flee).isEqualTo(sample.path("flee").asBoolean());
            var restored = adventure();
            restored.restore(adventure.snapshot());
            adventure = restored;
          }
      }
    }
    assertThat(flees).isEqualTo(14);
    assertThat(adventure.ravenDone()).isTrue();
    assertThat(other.ravenDone()).isFalse();
    assertThat(other.snapshot().path("raven").path("index").asInt()).isZero();
  }

  @Test
  void whiteRavenFollowsEveryMainBabePerchWithoutRewardsOrChangingEnding() throws Exception {
    var adventure = adventure();
    var other = adventure();
    int flees = 0;
    for (var leg : fixture("white-raven-trace.json").path("legs")) {
      var player = new Simulation(map, physics, false, false).snapshot();
      player.x = leg.path("player").path("x").asDouble();
      player.y = leg.path("player").path("y").asDouble();
      player.screen = leg.path("player").path("screen").asInt();
      for (int tick = 1; tick <= leg.path("ticks").asInt(); tick++) {
        boolean flee =
            adventure.tick(player, PlayerInput.NEUTRAL).stream()
                .anyMatch(event -> event.type().equals("FLEE") && event.id().equals("whiteRaven"));
        if (flee) flees++;
        for (var sample : leg.path("samples"))
          if (sample.path("tick").asInt() == tick) {
            assertJson(
                adventure.snapshot().path("whiteRaven"),
                sample.path("state"),
                "whiteRaven/" + tick);
            assertThat(flee).isEqualTo(sample.path("flee").asBoolean());
            var restored = adventure();
            restored.restore(adventure.snapshot());
            adventure = restored;
          }
      }
    }
    assertThat(flees).isEqualTo(17);
    assertThat(adventure.snapshot().path("whiteRaven").path("done").asBoolean()).isTrue();
    assertThat(adventure.ravenDone()).isFalse();
    assertThat(adventure.snapshot().path("flags")).isEmpty();
    assertThat(other.ravenDone()).isFalse();
    assertThat(other.snapshot().path("whiteRaven").path("index").asInt()).isZero();
  }

  @Test
  void ravenRestoreRejectsCorruptOrMissingProgress() {
    var adventure = adventure();
    var saved = adventure.snapshot();
    var invalid = saved.deepCopy();
    ((ObjectNode) invalid.path("raven")).put("index", 14);
    assertThatThrownBy(() -> adventure.restore(invalid))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
    var unrecorded = saved.deepCopy();
    unrecorded.remove("raven");
    assertThatThrownBy(() -> adventure.restore(unrecorded))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
    var invalidWhite = saved.deepCopy();
    ((ObjectNode) invalidWhite.path("whiteRaven")).put("index", 17);
    assertThatThrownBy(() -> adventure.restore(invalidWhite))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
    var unrecordedWhite = saved.deepCopy();
    unrecordedWhite.remove("whiteRaven");
    assertThatThrownBy(() -> adventure.restore(unrecordedWhite))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(adventure.snapshot()).isEqualTo(saved);
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
    state.remove("raven");
    state.remove("whiteRaven");
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
  void restoresDialogueAtomicallyAndRejectsUnsupportedCodec() {
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
    var unsupported = saved.deepCopy();
    unsupported.put("codecVersion", 99);
    assertThatThrownBy(() -> adventure.restore(unsupported))
        .isInstanceOf(IllegalArgumentException.class);
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
