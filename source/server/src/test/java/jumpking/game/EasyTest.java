package jumpking.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import jumpking.support.MainBabeRoute;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class EasyTest {
  private final ObjectMapper json = new ObjectMapper();
  private final SharedData shared;
  private final GameMap map;
  private final Physics physics;

  EasyTest() throws Exception {
    shared = new SharedData(json);
    map = json.treeToValue(shared.map(), GameMap.class);
    physics =
        new Physics(
            json.convertValue(shared.physics(), new TypeReference<Map<String, Number>>() {}));
  }

  private GameSimulation game() {
    return new GameSimulation(map, physics, shared.adventure(), true, false);
  }

  private void startFall(GameSimulation game) {
    var pose = game.physics().snapshot();
    pose.x = 200;
    pose.y = 280;
    pose.vx = 6;
    pose.vy = physics.maxFall;
    pose.grounded = false;
    pose.slipping = true;
    pose.charge = 4;
    pose.jumps = 12;
    pose.falls = 2;
    game.physics().restore(pose);
  }

  @Test
  void matchesSharedRespawnOracle() throws Exception {
    var game = game();
    JsonNode fixture;
    try (var input = new ClassPathResource("fixtures/easy-respawn.json").getInputStream()) {
      fixture = json.readTree(input);
    }
    var pose = game.physics().snapshot();
    pose.x = fixture.path("safe").path("x").asDouble();
    pose.y = fixture.path("safe").path("y").asDouble();
    pose.ticks = fixture.path("initialTicks").asLong();
    pose.jumps = fixture.path("jumps").asInt();
    pose.falls = fixture.path("falls").asInt();
    game.physics().restore(pose);
    game.tick(PlayerInput.NEUTRAL, "EASY");
    pose = game.physics().snapshot();
    pose.x = fixture.path("fall").path("x").asDouble();
    pose.y = fixture.path("fall").path("y").asDouble();
    pose.vy = fixture.path("fall").path("vy").asDouble();
    pose.grounded = false;
    game.physics().restore(pose);
    for (int tick = 0; tick < fixture.path("fallTicks").asInt(); tick++)
      game.tick(PlayerInput.NEUTRAL, "EASY");
    var actual = json.valueToTree(game.snapshot().physics());
    fixture
        .path("expected")
        .properties()
        .forEach(
            field -> {
              if (field.getValue().isNumber())
                assertThat(actual.path(field.getKey()).asDouble())
                    .as(field.getKey())
                    .isEqualTo(field.getValue().asDouble());
              else
                assertThat(actual.path(field.getKey()))
                    .as(field.getKey())
                    .isEqualTo(field.getValue());
            });
  }

  @Test
  void splatReturnsToLatestGroundedPositionAndKeepsCountersAndWorld() throws Exception {
    var game = game();
    game.tick(PlayerInput.NEUTRAL, "EASY");
    var first = game.snapshot().world().path("safePosition");
    for (int tick = 0; tick < 10; tick++) game.tick(new PlayerInput(false, true, false), "EASY");
    var saved = game.snapshot();
    var safe = saved.world().path("safePosition");
    assertThat(safe).isNotEqualTo(first);
    assertThat(safe.path("x").asDouble()).isEqualTo(saved.physics().x);
    startFall(game);
    var replay = game();
    replay.restore(
        json.readValue(json.writeValueAsBytes(game.snapshot()), GameSimulation.Snapshot.class));
    boolean splat = false;
    for (int tick = 0; tick < 8 && !splat; tick++) {
      var events = game.tick(PlayerInput.NEUTRAL, "EASY");
      assertThat(replay.tick(PlayerInput.NEUTRAL, "EASY")).isEqualTo(events);
      // JSON đọc lại có thể đổi LongNode thành IntNode; so sánh cùng biểu diễn trên wire.
      assertThat(json.readTree(json.writeValueAsBytes(replay.snapshot())))
          .isEqualTo(json.readTree(json.writeValueAsBytes(game.snapshot())));
      splat = events.movement().contains("SPLAT");
    }
    assertThat(splat).isTrue();
    var reset = game.snapshot();
    assertThat(reset.physics().x).isEqualTo(safe.path("x").asDouble());
    assertThat(reset.physics().y).isEqualTo(safe.path("y").asDouble());
    assertThat(reset.physics().ticks).isGreaterThan(saved.physics().ticks);
    assertThat(reset.physics().jumps).isEqualTo(12);
    assertThat(reset.physics().falls).isEqualTo(3);
    assertThat(reset.physics().vx).isZero();
    assertThat(reset.physics().vy).isZero();
    assertThat(reset.physics().charge).isZero();
    assertThat(reset.physics().slipping).isFalse();
    assertThat(reset.physics().jumpConsumed).isTrue();
    assertThat(reset.world().path("safePosition")).isEqualTo(safe);
    assertThat(reset.world().path("registeredScreens"))
        .isEqualTo(saved.world().path("registeredScreens"));
    assertThat(reset.adventure().path("raven").path("index"))
        .isEqualTo(saved.adventure().path("raven").path("index"));
    assertThat(reset.world().path("lastTick").asLong()).isEqualTo(reset.physics().ticks);
  }

  @Test
  void firstSplatFallsBackToSpawnAndOtherModesDoNotRecordSafePosition() {
    var game = game();
    startFall(game);
    boolean splat = false;
    for (int tick = 0; tick < 8 && !splat; tick++)
      splat = game.tick(PlayerInput.NEUTRAL, "EASY").movement().contains("SPLAT");
    assertThat(splat).isTrue();
    assertThat(game.snapshot().physics().x).isEqualTo(map.spawn().x());
    assertThat(game.snapshot().physics().y).isEqualTo(map.spawn().y());
    assertThat(game.snapshot().world().has("safePosition")).isFalse();
    for (String mode : List.of("RACE", "HARDCORE")) {
      var other = game();
      other.tick(PlayerInput.NEUTRAL, mode);
      assertThat(other.snapshot().world().has("safePosition")).isFalse();
    }
  }

  @Test
  void airborneFlightPhasingSplatAndSlipDoNotReplaceSafePosition() {
    for (String condition : List.of("AIR", "FLY", "PHASING", "SPLAT", "SLIP", "KNOCKED")) {
      var game = game();
      game.tick(PlayerInput.NEUTRAL, "EASY");
      var safe = game.snapshot().world().path("safePosition");
      var pose = game.physics().snapshot();
      pose.x = 200;
      switch (condition) {
        case "AIR", "KNOCKED" -> {
          pose.y = 200;
          pose.grounded = false;
          pose.knocked = condition.equals("KNOCKED");
        }
        case "FLY" -> pose.freeFlight = true;
        case "PHASING" -> {
          pose.phasingFall = true;
          pose.grounded = false;
        }
        case "SPLAT" -> pose.splat = physics.splatTicks;
        case "SLIP" -> {
          pose.slipping = true;
          pose.vx = 6;
        }
      }
      game.physics().restore(pose);
      game.tick(PlayerInput.NEUTRAL, "EASY");
      assertThat(game.snapshot().world().path("safePosition")).as(condition).isEqualTo(safe);
    }
  }

  @Test
  void malformedSafePositionsAreRejectedWithoutChangingState() {
    var game = game();
    game.tick(PlayerInput.NEUTRAL, "EASY");
    var saved = game.snapshot();
    for (var safe :
        List.of(
            json.nullNode(),
            json.getNodeFactory().textNode("invalid"),
            json.createObjectNode().put("x", 0),
            json.createObjectNode().put("x", "200").put("y", 302),
            json.createObjectNode().put("x", Double.NaN).put("y", 302),
            json.createObjectNode().put("x", 200).put("y", Double.POSITIVE_INFINITY),
            json.createObjectNode().put("x", -10).put("y", 302),
            json.createObjectNode().put("x", map.width()).put("y", 302),
            json.createObjectNode()
                .put("x", 200)
                .put("y", -map.screenHeight() * map.screens().size() - 1),
            json.createObjectNode().put("x", 200).put("y", map.screenHeight() + 1))) {
      var world = (ObjectNode) saved.world().deepCopy();
      world.set("safePosition", safe);
      assertThatThrownBy(
              () ->
                  game.restore(
                      new GameSimulation.Snapshot(1, saved.physics(), saved.adventure(), world)))
          .isInstanceOf(IllegalArgumentException.class);
      assertThat(json.<JsonNode>valueToTree(game.snapshot()))
          .isEqualTo(json.<JsonNode>valueToTree(saved));
    }
  }

  @Test
  void splatOnFinishDoesNotGrantWinOrEndingBeforeReturn() throws Exception {
    var before = MainBabeRoute.beforeFinish(shared, json);
    var pose = before.physics();
    pose.vy = physics.maxFall;
    pose.grounded = false;
    pose.splat = 0;
    pose.knocked = false;
    var game = game();
    game.restore(before);
    assertThat(game.tick(PlayerInput.NEUTRAL, "EASY").movement()).contains("SPLAT");
    assertThat(game.finished()).isFalse();
    assertThat(game.adventure().completed()).isFalse();
  }
}
