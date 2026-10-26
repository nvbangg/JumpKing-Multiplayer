package jumpking.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
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
  private final List<RoomScene> roomScenes;
  private final GameMap geometry;
  private final Physics tuning;
  private final List<GameMap> playableMaps;

  public record RoomMap(int level, String name, GameMap.Finish finish) {}

  public record RoomScene(int level, String name, double x, double y, double width) {}

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
    if (roomMaps.size() != 9) throw new IOException("Expected nine Room maps");
    for (int index = 0; index < roomMaps.size(); index++) {
      var goal = roomMaps.get(index);
      if (goal.level() != index + 1
          || goal.finish().screen() < 0
          || goal.finish().screen() >= 43
          || !goal.finish().requiresGrounded()
          || !Double.isFinite(goal.finish().minProgress())
          || goal.finish().minProgress() < 0
          || goal.finish().maxCenterX() != null
              && (!Double.isFinite(goal.finish().maxCenterX())
                  || goal.finish().maxCenterX() < goal.finish().minCenterX()
                  || goal.finish().maxCenterX() > map.path("width").asInt())
          || index > 0
              && (goal.finish().screen() < roomMaps.get(index - 1).finish().screen()
                  || goal.finish().screen() == roomMaps.get(index - 1).finish().screen()
                      && goal.finish().minProgress()
                          <= roomMaps.get(index - 1).finish().minProgress()))
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
    var scenes = new ArrayList<RoomScene>();
    for (int index = 0; index + 1 < roomMaps.size(); index++) {
      var goal = roomMaps.get(index);
      var nextMap = roomMaps.get(index + 1);
      var markerMap =
          new GameMap(
              geometry.width(),
              geometry.screenHeight(),
              geometry.tileSize(),
              geometry.progressOriginY(),
              geometry.spawn(),
              goal.finish(),
              geometry.screens());
      var platform = FinishPlatform.find(markerMap);
      if (platform == null || platform.width() <= 0)
        throw new IOException("Room scene marker has no finish platform");
      scenes.add(
          new RoomScene(
              nextMap.level(), nextMap.name(), platform.x(), platform.y(), platform.width()));
    }
    roomScenes = List.copyOf(scenes);
    // Định nghĩa bất biến dùng chung; state của mỗi người thuộc simulation riêng.
    var stages = new ArrayList<GameMap>();
    for (var goal : roomMaps) {
      var spawn = geometry.spawn();
      var origin = geometry.progressOriginY();
      var finish = goal.finish();
      Double roomBottomY = null;
      if (goal.level() > 1) {
        var previous = roomMaps.get(goal.level() - 2);
        var previousMap =
            new GameMap(
                geometry.width(),
                geometry.screenHeight(),
                geometry.tileSize(),
                geometry.progressOriginY(),
                geometry.spawn(),
                previous.finish(),
                geometry.screens());
        var platform = FinishPlatform.find(previousMap);
        if (platform == null || platform.width() <= 0)
          throw new IOException("Room Finish cannot provide a safe next-map spawn");
        spawn =
            new GameMap.Spawn(
                platform.x() + (platform.width() - tuning.bodyWidth) / 2,
                platform.y() - tuning.bodyHeight);
        // Tiến độ của mỗi chặng bắt đầu từ 0 nhưng tọa độ thế giới giữ nguyên.
        origin = spawn.y() + tuning.bodyHeight;
        finish =
            new GameMap.Finish(
                finish.screen(),
                finish.minCenterX(),
                finish.requiresGrounded(),
                finish.minProgress() == 0
                    ? 0
                    : finish.minProgress() + origin - geometry.progressOriginY(),
                finish.maxCenterX());
        roomBottomY = spawn.y();
      }
      stages.add(
          new GameMap(
              geometry.width(),
              geometry.screenHeight(),
              geometry.tileSize(),
              origin,
              spawn,
              finish,
              geometry.screens(),
              roomBottomY));
    }
    playableMaps = List.copyOf(stages);
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

  public List<RoomScene> roomScenes() {
    return roomScenes;
  }

  public JsonNode physics() {
    return physics.deepCopy();
  }

  // Các node định nghĩa nội bộ chỉ đọc; state thay đổi nằm trong từng GameSimulation.
  public JsonNode rules() {
    return rules;
  }

  public JsonNode adventure() {
    return adventure;
  }
}
