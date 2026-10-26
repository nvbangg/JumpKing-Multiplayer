package jumpking.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.Map;
import jumpking.game.*;

/** Tạo checkpoint trước Finish bằng toàn tuyến input hợp lệ, không bay/teleport. */
public final class MainBabeRoute {
  private MainBabeRoute() {}

  public static GameSimulation.Snapshot beforeFinish(SharedData shared, ObjectMapper json)
      throws Exception {
    var checkpoints =
        json.readTree(Path.of("../common/fixtures/main-babe-checkpoints.json").toFile());
    long target = checkpoints.get(checkpoints.size() - 1).path("ticks").asLong() - 1;
    var game =
        new GameSimulation(
            json.treeToValue(shared.map(), GameMap.class),
            new Physics(
                json.convertValue(
                    shared.physics(),
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Number>>() {})),
            shared.adventure(),
            shared.roomScenes(),
            false,
            false);
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
    if (game.physics().snapshot().ticks != target || game.finished())
      throw new IllegalStateException("Route did not reach the pre-Finish checkpoint");
    var snapshot = game.snapshot();
    game.tick(PlayerInput.NEUTRAL);
    if (!game.finished())
      throw new IllegalStateException("Route checkpoint does not Finish on the next tick");
    return snapshot;
  }
}
