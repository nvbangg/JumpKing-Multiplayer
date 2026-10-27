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
            new GameMap.Finish(14, 96, true, 5040, null),
            new GameMap.Finish(19, 216, true, 6896, null),
            new GameMap.Finish(25, 208, true, 9016, null),
            new GameMap.Finish(32, 72, true, 11504, 160.0),
            new GameMap.Finish(36, 416, true, 12960, null),
            new GameMap.Finish(39, 304, true, 14096, null),
            new GameMap.Finish(40, 328, true, 14560, null));
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
      else assertThat(stage.finish()).isEqualTo(new GameMap.Finish(40, 328, true, 464, null));

      var simulation = new Simulation(stage, physics, false, false);
      assertThat(simulation.snapshot().grounded).isTrue();
      assertThat(simulation.progress()).isZero();
      var game = new GameSimulation(stage, physics, shared.adventure(), false, false);
      for (int tick = 0; tick < physics.tickRate * 3; tick++)
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
    assertThat(full.spawn()).isEqualTo(new GameMap.Spawn(311, -13794));
    assertThat(full.progressOriginY()).isEqualTo(-13768);
    assertThat(full.finish().screen()).isEqualTo(40);
    assertThat(full.roomBottomY()).isEqualTo(full.spawn().y());
    assertThat(
            shared.roomMaps().stream().map(goal -> shared.roomMap(goal.level()).spawn()).toList())
        .containsExactly(
            shared.geometry().spawn(),
            new GameMap.Spawn(163, -786),
            new GameMap.Spawn(231, -1498),
            new GameMap.Spawn(23, -3082),
            new GameMap.Spawn(119, -4738),
            new GameMap.Spawn(231, -6594),
            new GameMap.Spawn(239, -8714),
            new GameMap.Spawn(107, -11202),
            new GameMap.Spawn(435, -12658),
            new GameMap.Spawn(311, -13794));
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
      double beyondFloor = platform.x() + platform.width();
      if (beyondFloor <= map.width() - physics.bodyWidth / 2.0) {
        state.x = beyondFloor;
        sim.restore(state);
        assertThat(sim.finished()).as("level %s beyond floor", goal.level()).isFalse();
      }
      state.x =
          map.finish().maxCenterX() == null
              ? x
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
    state.screen = 32;
    state.y = -11176 - shared.tuning().bodyHeight;
    for (double x : new double[] {63, 152}) {
      state.x = x;
      sim.restore(state);
      assertThat(sim.finished()).isEqualTo(x == 63);
    }
  }

  @Test
  void finalRoomStopsAtTheTowerBeforeTheCommunityFinish() throws Exception {
    var shared = new SharedData(new ObjectMapper());
    var room = shared.roomMap(10);
    assertThat(room.finish().screen()).isEqualTo(40);
    var roomSim = new Simulation(room, shared.tuning(), false, false);
    var roomState = roomSim.snapshot();
    roomState.screen = room.finish().screen();
    roomState.x = room.finish().minCenterX() - shared.tuning().bodyWidth / 2.0;
    roomState.y = room.progressOriginY() - shared.tuning().bodyHeight - room.finish().minProgress();
    roomState.grounded = true;
    roomSim.restore(roomState);
    assertThat(roomSim.finished()).isTrue();

    var community = new Simulation(shared.geometry(), shared.tuning(), false, false);
    community.restore(roomState);
    assertThat(community.finished()).isFalse();
  }

  @Test
  void unchangedRoomFinishMarkersRemainReachableFromTheNativeSpawn() throws Exception {
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
    for (var goal :
        shared.roomMaps().stream().filter(g -> g.level() <= 2 || g.level() == 10).toList()) {
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
        if (game.finished()) break;
      }
      var state = game.physics().snapshot();
      assertThat(game.finished()).as("level %s", goal.level()).isTrue();
      assertThat(state.screen).isEqualTo(goal.finish().screen());
      if (goal.level() < 10)
        assertThat(state.y + physics.bodyHeight)
            .isEqualTo(map.progressOriginY() - goal.finish().minProgress());
      assertThat(state.ticks)
          .isEqualTo(goal.level() == 1 ? 1021 : goal.level() == 2 ? 1815 : 16036);
      assertThat(state.falls).isZero();
      assertThat(state.freeFlight).isFalse();
      assertThat(game.adventure().completed()).isFalse();
      state.grounded = false;
      game.physics().restore(state);
      assertThat(game.finished()).isFalse();
    }
    var roomGame =
        new GameSimulation(shared.roomMap(10), physics, shared.adventure(), false, false);
    var finishState = checkpoint(json, 16036);
    roomGame.physics().restore(finishState);
    roomGame.tick(PlayerInput.NEUTRAL, "RACE");
    assertThat(roomGame.finished()).isTrue();
    assertThat(roomGame.adventure().completed()).isFalse();
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
