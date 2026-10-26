package jumpking.game;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class RoomMapsTest {
  @Test
  void allTenGoalsUseTheApprovedFinishBoundaries() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    assertThat(shared.roomMaps())
        .extracting(SharedData.RoomMap::finish)
        .containsExactly(
            new GameMap.Finish(3, 136, true, 1088, null),
            new GameMap.Finish(5, 152, true, 1800, null),
            new GameMap.Finish(9, 8, true, 3384, null),
            new GameMap.Finish(13, 216, true, 4912, null),
            new GameMap.Finish(18, 128, true, 6752, null),
            new GameMap.Finish(24, 208, true, 8744, null),
            new GameMap.Finish(31, 24, true, 11392, 72.0),
            new GameMap.Finish(35, 288, true, 12584, null),
            new GameMap.Finish(38, 248, true, 13912, null),
            new GameMap.Finish(42, 336, true, 0, null));
    assertThat(shared.geometry().finish()).isEqualTo(new GameMap.Finish(42, 336, true, 0, null));
  }

  @Test
  void roomMapsAfterTheFirstStartAtThePreviousFinish() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    var physics = shared.tuning();
    for (int level = 2; level <= 10; level++) {
      var previous = shared.roomMaps().get(level - 2);
      var previousMap =
          new GameMap(
              shared.geometry().width(),
              shared.geometry().screenHeight(),
              shared.geometry().tileSize(),
              shared.geometry().progressOriginY(),
              shared.geometry().spawn(),
              previous.finish(),
              shared.geometry().screens());
      var platform = FinishPlatform.find(previousMap);
      assertThat(platform).isNotNull();
      assertThat(platform.width()).isPositive();

      var stage = shared.roomMap(level);
      var expectedSpawn =
          new GameMap.Spawn(
              platform.x() + (platform.width() - physics.bodyWidth) / 2,
              platform.y() - physics.bodyHeight);
      assertThat(stage.spawn()).isEqualTo(expectedSpawn);
      assertThat(stage.roomBottomY()).isEqualTo(expectedSpawn.y());
      assertThat(stage.progressOriginY()).isEqualTo(expectedSpawn.y() + physics.bodyHeight);
      if (level < 10)
        assertThat(stage.progressOriginY() - stage.finish().minProgress())
            .isEqualTo(
                shared.geometry().progressOriginY()
                    - shared.roomMaps().get(level - 1).finish().minProgress());
      else assertThat(stage.finish()).isEqualTo(shared.geometry().finish());

      var simulation = new Simulation(stage, physics, false, false);
      assertThat(simulation.snapshot().grounded).isTrue();
      assertThat(simulation.progress()).isZero();
      var game = new GameSimulation(stage, physics, shared.adventure(), false, false);
      game.tick(PlayerInput.NEUTRAL, "RACE");
      var afterSpawn = game.physics().snapshot();
      assertThat(afterSpawn.x).isGreaterThanOrEqualTo(platform.x());
      assertThat(afterSpawn.x + physics.bodyWidth)
          .isLessThanOrEqualTo(platform.x() + platform.width());
      assertThat(afterSpawn.y).isEqualTo(expectedSpawn.y());
      assertThat(afterSpawn.grounded).isTrue();
    }

    var first = shared.roomMap(1);
    var full = shared.roomMap(10);
    assertThat(first.spawn()).isEqualTo(shared.geometry().spawn());
    assertThat(first.roomBottomY()).isNull();
    assertThat(full.spawn()).isEqualTo(new GameMap.Spawn(259, -13610));
    assertThat(full.progressOriginY()).isEqualTo(-13584);
    assertThat(full.finish()).isEqualTo(shared.geometry().finish());
    assertThat(full.roomBottomY()).isEqualTo(full.spawn().y());
    assertThat(
            shared.roomMaps().stream().map(goal -> shared.roomMap(goal.level()).spawn()).toList())
        .containsExactly(
            shared.geometry().spawn(),
            new GameMap.Spawn(163, -786),
            new GameMap.Spawn(231, -1498),
            new GameMap.Spawn(23, -3082),
            new GameMap.Spawn(239, -4610),
            new GameMap.Spawn(143, -6450),
            new GameMap.Spawn(235, -8442),
            new GameMap.Spawn(39, -11090),
            new GameMap.Spawn(327, -12282),
            new GameMap.Spawn(259, -13610));
  }

  @Test
  void fallingBelowAShortRoomReturnsToItsSpawnAndCountsOneFall() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    for (int level = 2; level <= 10; level++) {
      var stage = shared.roomMap(level);
      var game = new GameSimulation(stage, shared.tuning(), shared.adventure(), false, false);
      var state = game.physics().snapshot();
      state.y = stage.roomBottomY() + 100;
      state.screen =
          Math.max(
              0,
              Math.min(
                  stage.screens().size() - 1,
                  (int)
                      -Math.floor(
                          (state.y + shared.tuning().bodyHeight / 2.0) / stage.screenHeight())));
      state.grounded = false;
      state.vy = 0;
      game.physics().restore(state);

      var events = game.tick(PlayerInput.NEUTRAL, "RACE");
      var respawned = game.physics().snapshot();
      assertThat(events.movement()).contains("SPLAT");
      assertThat(respawned.x).isEqualTo(stage.spawn().x());
      assertThat(respawned.y).isEqualTo(stage.spawn().y());
      assertThat(respawned.falls).isEqualTo(state.falls + 1);
    }
  }

  @Test
  void eachGoalRequiresItsInclusiveHorizontalAndProgressBoundariesAndGrounded() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    var physics = shared.tuning();
    for (var goal : shared.roomMaps().subList(0, 9)) {
      var map =
          new GameMap(
              shared.geometry().width(),
              shared.geometry().screenHeight(),
              shared.geometry().tileSize(),
              shared.geometry().progressOriginY(),
              shared.geometry().spawn(),
              goal.finish(),
              shared.geometry().screens());
      var sim = new Simulation(map, physics, false, false);
      var state = sim.snapshot();
      state.screen = goal.finish().screen();
      state.x = goal.finish().minCenterX() - physics.bodyWidth / 2.0;
      state.y = map.progressOriginY() - physics.bodyHeight - goal.finish().minProgress();
      sim.restore(state);
      assertThat(sim.finished()).as("level %s at boundary", goal.level()).isTrue();

      state.x -= 0.25;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s below minCenterX", goal.level()).isFalse();
      state.x += 0.25;

      state.y += 0.25;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s below minProgress", goal.level()).isFalse();
      state.y -= 0.5;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s above the selected floor", goal.level()).isFalse();
      state.y += 0.25;

      state.screen--;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s wrong screen", goal.level()).isFalse();
      state.screen++;
      double x = state.x;
      var platform = FinishPlatform.find(map);
      state.x = platform.x() + platform.width();
      sim.restore(state);
      assertThat(sim.finished()).as("level %s beyond floor", goal.level()).isFalse();
      state.x =
          map.finish().maxCenterX() == null
              ? state.x - 0.25
              : map.finish().maxCenterX() - physics.bodyWidth / 2.0;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s inside right boundary", goal.level()).isTrue();
      state.x = x;

      state.grounded = false;
      sim.restore(state);
      assertThat(sim.finished()).as("level %s while airborne", goal.level()).isFalse();
    }
  }

  @Test
  void higherPlatformInTheFinishScreenDoesNotEndAShortRoom() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    var map = shared.roomMap(1);
    var sim = new Simulation(map, shared.tuning(), false, false);
    var state = checkpoint(json, 1182);
    sim.restore(state);
    assertThat(state.grounded).isTrue();
    assertThat(state.screen).isEqualTo(map.finish().screen());
    assertThat(state.x + shared.tuning().bodyWidth / 2.0)
        .isGreaterThanOrEqualTo(map.finish().minCenterX());
    assertThat(sim.progress()).isGreaterThan(map.finish().minProgress());
    assertThat(sim.finished()).isFalse();
  }

  @Test
  void leftBrazierFinishRejectsTheRestOfTheWalkway() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    var sim = new Simulation(shared.roomMap(7), shared.tuning(), false, false);
    var state = sim.snapshot();
    state.screen = 31;
    state.y = -11064 - shared.tuning().bodyHeight;
    for (double x : new double[] {60, 64, 152}) {
      state.x = x;
      sim.restore(state);
      assertThat(sim.finished()).isEqualTo(x == 60);
    }
  }

  @Test
  void fullRoomKeepsTheNativeSoloAndCommunityFinish() throws Exception {
    var json = new ObjectMapper();
    var shared = new SharedData(json);
    for (int ticks : new int[] {16861, 16957}) {
      var original = new Simulation(shared.geometry(), shared.tuning(), false, false);
      var room = new Simulation(shared.roomMap(10), shared.tuning(), false, false);
      var state = checkpoint(json, ticks);
      original.restore(state);
      room.restore(state);
      assertThat(original.finished()).isEqualTo(ticks == 16957);
      assertThat(room.finished()).isEqualTo(original.finished());
    }
  }

  @Test
  void allRoomFinishMarkersRemainReachableFromTheNativeSpawn() throws Exception {
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
      var map =
          new GameMap(
              shared.geometry().width(),
              shared.geometry().screenHeight(),
              shared.geometry().tileSize(),
              shared.geometry().progressOriginY(),
              shared.geometry().spawn(),
              goal.finish(),
              shared.geometry().screens());
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
        // Bước tới tâm cột cờ sau cú nhảy cuối của đoạn leo.
        if (goal.level() == 6 && game.physics().snapshot().ticks == 9469)
          for (int tick = 0; tick < 4; tick++) game.tick(new PlayerInput(false, true, false));
        if (game.finished()) break;
      }
      var state = game.physics().snapshot();
      assertThat(game.finished()).as("level %s", goal.level()).isTrue();
      assertThat(state.screen).isEqualTo(goal.finish().screen());
      if (goal.level() < 10)
        assertThat(state.y + physics.bodyHeight)
            .isEqualTo(map.progressOriginY() - goal.finish().minProgress());
      assertThat(state.ticks)
          .isEqualTo(
              new int[] {1021, 1815, 4078, 5524, 7538, 9253, 12908, 14058, 15426, 16957}
                  [goal.level() - 1]);
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

  private PlayerState checkpoint(ObjectMapper json, int ticks) throws Exception {
    try (var input =
        new ClassPathResource("fixtures/main-babe-checkpoints.json").getInputStream()) {
      for (var checkpoint : json.readTree(input)) {
        if (checkpoint.path("ticks").asInt() == ticks)
          return json.treeToValue(checkpoint, PlayerState.class);
      }
    }
    throw new IllegalArgumentException("Missing route checkpoint: " + ticks);
  }
}
