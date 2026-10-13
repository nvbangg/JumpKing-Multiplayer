package jumpking.controller;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import jumpking.config.FeatureFlags;
import jumpking.game.SharedData;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GameConfigController {
  private final SharedData shared;
  private final FeatureFlags flags;

  public GameConfigController(SharedData shared, FeatureFlags flags) {
    this.shared = shared;
    this.flags = flags;
  }

  @GetMapping("/api/map")
  public JsonNode map() {
    return shared.map();
  }

  @GetMapping("/api/game-config")
  public Map<String, ?> config() {
    return Map.of("features", Map.of("flyEnabled", flags.flyEnabled()));
  }
}
