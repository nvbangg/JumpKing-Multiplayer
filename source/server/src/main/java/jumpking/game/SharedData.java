package jumpking.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
public class SharedData {
  private final JsonNode map;
  private final JsonNode physics;
  private final JsonNode rules;
  private final JsonNode adventure;
  private final List<RoomMap> roomMaps;
  private final GameMap geometry;
  private final Physics tuning;
  private final List<GameMap> playableMaps;

  public record RoomMap(int level, String name, GameMap.Finish finish) {}

  public SharedData(ObjectMapper mapper) throws IOException {
    map = read(mapper, "maps/main-babe.json");
    physics = read(mapper, "physics.json");
    rules = read(mapper, "rules.json");
    adventure = read(mapper, "adventure.json");
    roomMaps =
        List.copyOf(
            mapper.convertValue(
                read(mapper, "room-maps.json"),
                new com.fasterxml.jackson.core.type.TypeReference<List<RoomMap>>() {}));
    if (roomMaps.size() != 10) throw new IOException("Expected ten Room lengths");
    for (int index = 0; index < roomMaps.size(); index++) {
      var goal = roomMaps.get(index);
      if (goal.level() != index + 1
          || goal.finish().screen() < 0
          || goal.finish().screen() >= 43
          || !goal.finish().requiresGrounded()
          || !Double.isFinite(goal.finish().minProgress())
          || goal.finish().minProgress() < 0
          || index > 0 && goal.finish().screen() <= roomMaps.get(index - 1).finish().screen())
        throw new IOException("Invalid Room finish boundary");
    }
    if (map.path("width").asInt() != 480
        || map.path("screenHeight").asInt() != 360
        || map.path("tileSize").asInt() != 8
        || map.path("screens").size() != 43
        || map.path("finish").path("screen").asInt() != 42)
      throw new IOException("Invalid Main Babe geometry");
    for (JsonNode screen : map.path("screens")) {
      if (screen.path("tiles").size() != 45 || !screen.path("wind").isBoolean())
        throw new IOException("Invalid Main Babe screen");
      screen
          .fieldNames()
          .forEachRemaining(
              key -> {
                if (!Set.of("tiles", "wind").contains(key))
                  throw new IllegalArgumentException(
                      "Presentation does not belong in simulation data");
              });
      for (JsonNode row : screen.path("tiles"))
        if (!row.isTextual()
            || row.textValue().length() != 60
            || !row.textValue().matches("[ #INabcd]+")) throw new IOException("Invalid terrain");
    }
    geometry = mapper.convertValue(map, GameMap.class);
    tuning =
        new Physics(
            mapper.convertValue(
                physics,
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Number>>() {}));
    // Định nghĩa bất biến dùng chung; state của mỗi người thuộc simulation riêng.
    playableMaps =
        roomMaps.stream()
            .map(
                goal ->
                    new GameMap(
                        geometry.width(),
                        geometry.screenHeight(),
                        geometry.tileSize(),
                        geometry.progressOriginY(),
                        geometry.spawn(),
                        goal.finish(),
                        geometry.screens()))
            .toList();
  }

  private JsonNode read(ObjectMapper mapper, String name) throws IOException {
    try (var stream = new ClassPathResource("shared/" + name).getInputStream()) {
      return mapper.readTree(stream);
    }
  }

  public JsonNode map() {
    return map.deepCopy();
  }

  public GameMap geometry() {
    return geometry;
  }

  public Physics tuning() {
    return tuning;
  }

  public GameMap roomMap(int level) {
    if (level < 1 || level > roomMaps.size())
      throw new IllegalArgumentException("Invalid Room map level");
    return playableMaps.get(level - 1);
  }

  public List<RoomMap> roomMaps() {
    return roomMaps;
  }

  public JsonNode physics() {
    return physics.deepCopy();
  }

  public JsonNode rules() {
    return rules.deepCopy();
  }

  public JsonNode adventure() {
    return adventure.deepCopy();
  }
}
