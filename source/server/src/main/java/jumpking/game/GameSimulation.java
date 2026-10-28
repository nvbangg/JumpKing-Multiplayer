package jumpking.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public final class GameSimulation {
  public record Snapshot(
      int codecVersion, PlayerState physics, JsonNode adventure, JsonNode world) {}

  public record WorldEvent(String type, String id) {}

  public record Events(
      List<String> movement, List<Adventure.Event> adventure, List<WorldEvent> world) {}

  private final GameMap map;
  private final Physics p;
  private final JsonNode data;
  private final boolean flyAllowed, noWalk, roomAdventure;
  private Simulation physics;
  private Adventure adventure;
  private ObjectNode world;

  public GameSimulation(GameMap map, Physics p, JsonNode data, boolean flyAllowed, boolean noWalk) {
    this(map, p, data, flyAllowed, noWalk, false);
  }

  public GameSimulation(
      GameMap map, Physics p, JsonNode data, boolean flyAllowed, boolean noWalk, boolean roomAdventure) {
    this.map = map;
    this.p = p;
    this.data = data;
    this.flyAllowed = flyAllowed;
    this.noWalk = noWalk;
    this.roomAdventure = roomAdventure;
    physics = new Simulation(map, p, flyAllowed, noWalk);
    adventure =
        new Adventure(
            data,
            map,
            p,
            roomAdventure && physics.snapshot().screen > 0 ? physics.snapshot().screen : null);
    world = JsonNodeFactory.instance.objectNode().put("lastTick", 0).put("weatherWind", 0);
    world.putArray("registeredScreens");
    var walls = world.putObject("walls");
    for (JsonNode wall : data.path("walls"))
      walls
          .putObject(wall.path("id").asText())
          .put("touching", false)
          .put("canPlay", true)
          .put("fadeTicks", data.path("tuning").path("wallFadeTicks").asInt());
  }

  public Simulation physics() {
    return physics;
  }

  public Adventure adventure() {
    return adventure;
  }

  public boolean finished() {
    return physics.finished();
  }

  public Snapshot snapshot() {
    return new Snapshot(1, physics.snapshot(), adventure.snapshot(), world.deepCopy());
  }

  public void restore(Snapshot saved) {
    var w = saved.world();
    if (saved.codecVersion() != 1
        || saved.physics() == null
        || w == null
        || !w.isObject()
        || !w.path("lastTick").isIntegralNumber()
        || w.path("lastTick").asLong() != saved.physics().ticks
        || !w.path("weatherWind").isNumber()
        || !Double.isFinite(w.path("weatherWind").asDouble())
        || !w.path("registeredScreens").isArray()
        || !w.path("walls").isObject())
      throw new IllegalArgumentException("Invalid world snapshot");
    var screens = new HashSet<Integer>();
    for (JsonNode screen : w.path("registeredScreens"))
      if (!screen.isIntegralNumber()
          || screen.asInt() < 0
          || screen.asInt() >= map.screens().size()
          || !screens.add(screen.asInt()))
        throw new IllegalArgumentException("Invalid registered screen");
    if (w.has("safePosition")) {
      var safe = w.path("safePosition");
      double x = safe.path("x").asDouble(), y = safe.path("y").asDouble();
      if (!safe.isObject()
          || !safe.path("x").isNumber()
          || !safe.path("y").isNumber()
          || !Double.isFinite(x)
          || !Double.isFinite(y)
          || x < -p.bodyWidth / 2.0
          || x > map.width() - p.bodyWidth / 2.0
          || y < -(double) map.screenHeight() * map.screens().size()
          || y > map.screenHeight()) throw new IllegalArgumentException("Invalid safe position");
    }
    for (JsonNode wall : data.path("walls")) {
      var state = w.path("walls").path(wall.path("id").asText());
      if (!state.path("touching").isBoolean()
          || !state.path("canPlay").isBoolean()
          || !state.path("fadeTicks").isIntegralNumber()
          || state.path("fadeTicks").asInt() < 0
          || state.path("fadeTicks").asInt() > data.path("tuning").path("wallFadeTicks").asInt())
        throw new IllegalArgumentException("Invalid wall snapshot");
    }
    var candidate = new GameSimulation(map, p, data, flyAllowed, noWalk, roomAdventure);
    candidate.physics.restore(saved.physics());
    candidate.adventure.restore(saved.adventure());
    physics = candidate.physics;
    adventure = candidate.adventure;
    world = w.deepCopy();
  }

  public Events tick(PlayerInput input) {
    return tick(input, "RACE");
  }

  public Events tick(PlayerInput input, String mode) {
    double previousY = physics.y();
    var movement = physics.tick(input);
    var player = physics.snapshot();
    if (map.roomBottomY() != null
        && (previousY > map.roomBottomY() || player.y > map.roomBottomY())) {
      boolean alreadyFell = movement.contains("SPLAT");
      physics.respawnAt(map.spawn().x(), map.spawn().y(), !alreadyFell);
      if (!alreadyFell) {
        movement = new ArrayList<>(movement);
        movement.add("SPLAT");
      }
      player = physics.snapshot();
    } else if (movement.contains("SPLAT") && (mode.equals("HARDCORE") || mode.equals("EASY"))) {
      if (mode.equals("EASY")) {
        var safe = world.path("safePosition");
        physics.respawnAt(
            safe.path("x").asDouble(map.spawn().x()), safe.path("y").asDouble(map.spawn().y()));
      } else physics.respawn();
      player = physics.snapshot();
    } else if (mode.equals("EASY")
        && player.grounded
        && !player.freeFlight
        && !player.phasingFall
        && player.splat == 0
        && !player.slipping
        && !player.knocked) {
      // Ghi nền an toàn sau xử lý vật lý; cú đáp gây SPLAT không thay mốc trước đó.
      world.withObject("safePosition").put("x", player.x).put("y", player.y);
    }
    var content = adventure.tick(player, input);
    var events = new ArrayList<WorldEvent>();
    if (finished()
        && map.roomBottomY() == null
        && map.finish().screen() == map.screens().size() - 1) adventure.complete();
    double phase = player.ticks / (double) p.tickRate * p.windFrequency;
    double force =
        Math.max(-1, Math.min(1, 2 * Math.sin(phase) + (Math.cos(phase) > 0 ? 1 : -1)))
            * p.windAcceleration;
    world
        .put("weatherWind", player.wind ? world.path("weatherWind").asDouble() - force * 2 / 3 : 0)
        .put("lastTick", player.ticks);
    var registered = (ArrayNode) world.path("registeredScreens");
    boolean seen = false;
    for (JsonNode screen : registered) if (screen.asInt() == player.screen) seen = true;
    if (player.grounded && !seen) {
      registered.add(player.screen);
      if (player.screen == map.finish().screen()) events.add(new WorldEvent("JINGLE", "finish"));
    }
    for (JsonNode wall : data.path("walls")) {
      String id = wall.path("id").asText();
      var state = (ObjectNode) world.path("walls").path(id);
      boolean touching = false;
      for (JsonNode rect : wall.path("hitboxes"))
        if ((int) player.x < rect.path("x").asDouble() + rect.path("width").asDouble()
            && (int) player.x + p.bodyWidth > rect.path("x").asDouble()
            && (int) player.y < rect.path("y").asDouble() + rect.path("height").asDouble()
            && (int) player.y + p.bodyHeight > rect.path("y").asDouble()) touching = true;
      if (touching != state.path("touching").asBoolean()
          && touching
          && state.path("canPlay").asBoolean()) events.add(new WorldEvent("WALL", id));
      if (touching != state.path("touching").asBoolean() && !touching)
        state.put("canPlay", wall.path("everyTime").asBoolean());
      state
          .put("touching", touching)
          .put(
              "fadeTicks",
              Math.max(
                  0,
                  Math.min(
                      data.path("tuning").path("wallFadeTicks").asInt(),
                      state.path("fadeTicks").asInt() + (touching ? -1 : 1))));
    }
    return new Events(movement, content, List.copyOf(events));
  }
}
