package jumpking.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import jumpking.game.*;

/** Tạo checkpoint trước Finish bằng toàn tuyến input hợp lệ, không bay/teleport. */
public final class MainBabeRoute {
  private MainBabeRoute() {}

  public static GameSimulation.Snapshot beforeFinish(SharedData shared, ObjectMapper json)
      throws Exception {
    var checkpoints =
        json.readTree(Path.of("../common/fixtures/main-babe-checkpoints.json").toFile());
    long target = checkpoints.get(checkpoints.size() - 1).path("ticks").asLong() - 1;
    return beforeFinish(shared, json, target, shared.geometry());
  }

  public static GameSimulation.Snapshot beforeRoomFinish(SharedData shared, ObjectMapper json)
      throws Exception {
    var goal = shared.roomMap(shared.roomMaps().size());
    var probe = new Simulation(goal, shared.tuning(), false, false);
    for (var checkpoint :
        json.readTree(Path.of("../common/fixtures/main-babe-checkpoints.json").toFile())) {
      probe.restore(json.treeToValue(checkpoint, PlayerState.class));
      if (probe.finished())
        return beforeFinish(shared, json, checkpoint.path("ticks").asLong() - 1, goal);
    }
    throw new IllegalStateException("Route has no Room Finish checkpoint");
  }

  private static GameSimulation.Snapshot beforeFinish(
      SharedData shared, ObjectMapper json, long target, GameMap goal) throws Exception {
    var game =
        new GameSimulation(shared.geometry(), shared.tuning(), shared.adventure(), false, false);
    java.util.function.Consumer<PlayerInput> step =
        input -> {
          if (game.physics().snapshot().ticks < target) game.tick(input);
        };
    for (int index = 0; index < 30; index++) step.accept(PlayerInput.NEUTRAL);
    for (var action : json.readTree(Path.of("../common/fixtures/main-babe-route.json").toFile())) {
      if (action.has("walk")) {
        for (int index = 0; index < action.path("ticks").asInt(); index++)
          step.accept(
              new PlayerInput(
                  action.path("walk").asInt() < 0, action.path("walk").asInt() > 0, false));
      } else {
        step.accept(PlayerInput.NEUTRAL);
        int charge = action.path("charge").asInt(), direction = action.path("direction").asInt();
        for (int index = 0; index < charge; index++)
          step.accept(
              new PlayerInput(charge == 36 && direction < 0, charge == 36 && direction > 0, true));
        if (charge != 36) step.accept(new PlayerInput(direction < 0, direction > 0, false));
        for (int index = 0; index < 180 && game.physics().snapshot().ticks < target; index++) {
          step.accept(PlayerInput.NEUTRAL);
          if (game.physics().snapshot().grounded && index > 0) break;
        }
      }
      if (game.physics().snapshot().ticks >= target) break;
    }
    if (game.physics().snapshot().ticks != target)
      throw new IllegalStateException("Route did not reach the pre-Finish checkpoint");
    var snapshot = game.snapshot();
    var check = new GameSimulation(goal, shared.tuning(), shared.adventure(), false, false);
    check.restore(snapshot);
    if (check.finished()) throw new IllegalStateException("Route checkpoint already finished");
    check.tick(PlayerInput.NEUTRAL);
    if (!check.finished())
      throw new IllegalStateException("Route checkpoint does not Finish on the next tick");
    return snapshot;
  }
}
