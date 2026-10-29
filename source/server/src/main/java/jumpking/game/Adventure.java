package jumpking.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public final class Adventure {
  public record Event(String type, String id) {}

  private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
  private final JsonNode data, tuning;
  private final GameMap map;
  private final Physics physics;
  private ObjectNode state;

  public Adventure(JsonNode definitions, GameMap map, Physics physics) {
    data = definitions;
    tuning = data.path("tuning");
    this.map = map;
    this.physics = physics;
    state = JSON.objectNode().put("codecVersion", 2);
    state.putArray("flags");
    state.putObject("dialogue");
    state.putObject("readables");
    for (String bird : List.of("raven", "whiteRaven")) state.set(bird, freshRaven(bird));
    for (JsonNode npc : data.path("npcs")) {
      var value =
          JSON.objectNode()
              .put("introduced", npc.path("introLengths").isEmpty())
              .put("best", 0)
              .put("loop", 0)
              .putNull("quote")
              .put("line", 0)
              .put("ticks", 0)
              .put("wait", 0)
              .put("busy", 0)
              .put("talks", 0);
      value.putArray("pool");
      value.putObject("flags");
      object(state, "dialogue").set(npc.path("id").asText(), value);
    }
    for (JsonNode readable : data.path("readables"))
      object(state, "readables").set(readable.path("id").asText(), freshReadable());
  }

  private static ObjectNode object(JsonNode node, String key) {
    return (ObjectNode) node.get(key);
  }

  private static ArrayNode array(JsonNode node, String key) {
    return (ArrayNode) node.get(key);
  }

  private static double number(JsonNode node, String key) {
    return node.path(key).asDouble();
  }

  private double tuning(String key) {
    return number(tuning, key);
  }

  private static JsonNode find(JsonNode entries, String key, String value) {
    for (JsonNode entry : entries) if (entry.path(key).asText().equals(value)) return entry;
    return null;
  }

  private static boolean contains(JsonNode values, String value) {
    for (JsonNode entry : values) if (entry.asText().equals(value)) return true;
    return false;
  }

  private static ObjectNode freshReadable() {
    return JSON.objectNode().put("wait", 0).put("line", 0).put("ticks", 0).put("done", false);
  }

  private ObjectNode freshRaven(String bird) {
    var positions = data.path(bird).path("positions");
    int index = 0;
    if (map.roomBottomY() != null) {
      while (index < positions.size()) {
        var perch = positions.get(index);
        if (number(perch, "y") - perch.path("screen").asInt() * map.screenHeight()
                <= map.roomBottomY()
            && perch.path("screen").asInt() <= map.finish().screen()) break;
        index++;
      }
    }
    boolean done = index == positions.size();
    if (done) index = positions.size() - 1;
    var first = positions.get(index);
    return JSON.objectNode()
        .put("index", index)
        .put("x", number(first, "x"))
        .put("y", number(first, "y") - first.path("screen").asInt() * map.screenHeight())
        .put("vx", 0)
        .put("vy", 0)
        .put("flying", false)
        .put("ticks", 0)
        .put("done", done);
  }

  public boolean ravenDone() {
    return state.path("raven").path("done").asBoolean();
  }

  private void tickRaven(String bird, PlayerState player, List<Event> events) {
    var s = object(state, bird);
    var positions = data.path(bird).path("positions");
    var pos = positions.get(s.path("index").asInt());
    if (s.path("done").asBoolean()) return;
    double dx = (int) player.x + physics.bodyWidth / 2.0 - number(s, "x"),
        dy = (int) player.y + physics.bodyHeight / 2.0 - number(s, "y");
    if (!s.path("flying").asBoolean()
        && player.screen == pos.path("screen").asInt()
        && dx * dx + dy * dy < Math.pow(number(data.path("raven"), "triggerRadius"), 2)) {
      s.put("flying", true).put("ticks", 0);
      s.put("vy", number(data.path("raven"), "launchVelocityY")).put("vx", 0);
      events.add(new Event("FLEE", bird));
    }
    if (!s.path("flying").asBoolean()) return;
    if (increment(s, "ticks") % data.path("raven").path("accelerationTicks").asInt() == 0) {
      s.put(
          "vx",
          number(s, "vx")
              + number(pos, "flyDirection") * number(data.path("raven"), "accelerationX"));
      s.put("vy", number(s, "vy") * number(data.path("raven"), "velocityGrowthY"));
    }
    s.put("x", number(s, "x") + number(s, "vx") * number(data.path("raven"), "motionScale"));
    s.put("y", number(s, "y") + number(s, "vy") * number(data.path("raven"), "motionScale"));
    double localY = number(s, "y") + pos.path("screen").asInt() * map.screenHeight();
    if (number(s, "x") < 0
        || number(s, "x") >= map.width()
        || localY < 0
        || localY >= map.screenHeight()) {
      int index = increment(s, "index");
      if (index >= positions.size()) {
        s.put("done", true);
        index = positions.size() - 1;
        s.put("index", index);
      }
      var next = positions.get(index);
      s.put("flying", false)
          .put("x", number(next, "x"))
          .put("y", number(next, "y") - next.path("screen").asInt() * map.screenHeight());
    }
  }

  private static int increment(ObjectNode node, String key) {
    int value = node.path(key).asInt() + 1;
    node.put(key, value);
    return value;
  }

  public ObjectNode snapshot() {
    return state.deepCopy();
  }

  public boolean completed() {
    return contains(state.path("flags"), "CompletedNormalGame");
  }

  public void complete() {
    if (!completed()) array(state, "flags").add("CompletedNormalGame");
  }

  public JsonNode quoteLengths(String id, String quote) {
    var npc = find(data.path("npcs"), "id", id);
    if (npc == null || quote == null) return JSON.arrayNode();
    String[] parts = quote.split(":");
    JsonNode lengths = null;
    try {
      if (quote.equals("intro")) lengths = npc.path("introLengths");
      else if (parts[0].equals("progress"))
        lengths = npc.path("progressQuotes").path(Integer.parseInt(parts[1])).path("lineLengths");
      else if (parts[0].equals("loop"))
        lengths = npc.path("loopLengths").path(Integer.parseInt(parts[1]));
      else if (parts[0].equals("flag"))
        lengths =
            npc.path("flagQuotes")
                .path(Integer.parseInt(parts[1]))
                .path("sequences")
                .path(Integer.parseInt(parts[2]));
    } catch (NumberFormatException | ArrayIndexOutOfBoundsException ignored) {
    }
    return lengths != null && lengths.isArray() ? lengths : JSON.arrayNode();
  }

  private boolean overlap(PlayerState p, double x, double y, double width, double height) {
    return (int) p.x < x + width
        && (int) p.x + physics.bodyWidth > x
        && (int) p.y < y + height
        && (int) p.y + physics.bodyHeight > y;
  }

  private boolean touching(PlayerState p, JsonNode rect, int screen) {
    return overlap(
        p,
        number(rect, "x"),
        number(rect, "y") - screen * map.screenHeight(),
        number(rect, "width"),
        number(rect, "height"));
  }

  public List<Event> tick(PlayerState player, PlayerInput input) {
    var events = new ArrayList<Event>();
    for (JsonNode npc : data.path("npcs")) {
      String id = npc.path("id").asText();
      var s = object(state.path("dialogue"), id);
      var quotes = npc.path("progressQuotes");
      var matched = new ArrayList<Integer>();
      for (int i = 0; i < quotes.size(); i++)
        if (quotes.get(i).path("screen").asInt() == player.screen + 1) matched.add(i);
      if (!matched.isEmpty() && player.screen + 1 > s.path("best").asInt()) {
        s.put("best", player.screen + 1);
        for (int i = matched.size() - 1; i >= 0; i--)
          array(s, "pool").add("progress:" + matched.get(i));
      }
      if (s.path("busy").asInt() > 0) {
        s.put("busy", s.path("busy").asInt() - 1);
        continue;
      }
      if (!s.path("quote").isNull()) {
        var lengths = quoteLengths(id, s.path("quote").asText());
        if (increment(s, "ticks")
            >= lengths.get(s.path("line").asInt()).asInt()
                    * number(npc, "characterSeconds")
                    * physics.tickRate
                + tuning("speechHoldTicks")) {
          s.put("ticks", 0);
          if (increment(s, "line") >= lengths.size())
            s.putNull("quote").put("line", 0).put("busy", (int) tuning("npcBusyTicks"));
        }
        continue;
      }
      s.put(
          "wait",
          touching(player, npc.path("trigger"), npc.path("screen").asInt())
              ? s.path("wait").asInt() + 1
              : 0);
      if (s.path("wait").asInt() < npc.path("delayTicks").asInt()) continue;
      s.put("wait", 0);
      int flagged = -1;
      var flagQuotes = npc.path("flagQuotes");
      for (int i = 0; i < flagQuotes.size(); i++) {
        var quote = flagQuotes.get(i);
        if (contains(state.path("flags"), quote.path("flag").asText())
            && s.path("flags").path(quote.path("flag").asText()).asInt()
                < quote.path("sequences").size()) {
          flagged = i;
          break;
        }
      }
      boolean consumed = true;
      if (flagged >= 0) {
        String flag = flagQuotes.get(flagged).path("flag").asText();
        int index = s.path("flags").path(flag).asInt();
        s.put("quote", "flag:" + flagged + ":" + index).put("introduced", true);
        object(s, "flags").put(flag, index + 1);
      } else if (!s.path("introduced").asBoolean()) s.put("quote", "intro").put("introduced", true);
      else if (!s.path("pool").isEmpty()) {
        var pool = array(s, "pool");
        s.put("quote", pool.remove(pool.size() - 1).asText());
      } else {
        int size = npc.path("loopLengths").size();
        if (size > 0) s.put("quote", "loop:" + s.path("loop").asInt() % size);
        else s.putNull("quote");
        increment(s, "loop");
        consumed = false;
      }
      if (consumed && !s.path("quote").isNull()) increment(s, "talks");
    }
    for (JsonNode readable : data.path("readables")) {
      String id = readable.path("id").asText();
      var s = object(state.path("readables"), id);
      if (!touching(player, readable.path("trigger"), readable.path("screen").asInt())) {
        if (s.path("wait").asInt() != 0
            || s.path("line").asInt() != 0
            || s.path("ticks").asInt() != 0
            || s.path("done").asBoolean())
          s.put("wait", 0).put("line", 0).put("ticks", 0).put("done", false);
        continue;
      }
      if (s.path("done").asBoolean()) continue;
      if (s.path("wait").asInt() < tuning("readableWaitTicks")) {
        s.put(
            "wait", input.left() != input.right() || input.jump() ? 0 : s.path("wait").asInt() + 1);
        continue;
      }
      int ticks = increment(s, "ticks"),
          line = s.path("line").asInt(),
          length = readable.path("lineLengths").get(line).asInt();
      if (ticks % (int) tuning("readableCharacterTicks") == 0
          && ticks <= length * tuning("readableCharacterTicks"))
        events.add(new Event("SPEECH", id));
      if (ticks >= length * tuning("readableCharacterTicks") + tuning("speechHoldTicks")) {
        s.put("ticks", 0);
        if (line + 1 < readable.path("lineLengths").size()) s.put("line", line + 1);
        else s.put("done", true);
      }
    }
    for (String bird : List.of("raven", "whiteRaven")) tickRaven(bird, player, events);
    return List.copyOf(events);
  }

  private boolean count(JsonNode value) {
    return value.isIntegralNumber()
        && value.canConvertToInt()
        && value.asInt() >= 0
        && value.asInt() <= tuning("maxCounter");
  }

  private void require(boolean valid) {
    if (!valid) throw new IllegalArgumentException("Invalid adventure snapshot");
  }

  private void counts(JsonNode value, String... fields) {
    for (String field : fields) require(count(value.path(field)));
  }

  public void restore(JsonNode saved) {
    require(saved != null && saved.isObject());
    require(
        saved.path("codecVersion").isIntegralNumber()
            && saved.path("codecVersion").asInt() == 2
            && saved.path("flags").isArray());
    var seen = new HashSet<String>();
    for (JsonNode flag : saved.path("flags"))
      require(
          flag.isTextual()
              && seen.add(flag.asText())
              && flag.asText().equals("CompletedNormalGame"));
    for (JsonNode npc : data.path("npcs")) {
      String id = npc.path("id").asText();
      var s = saved.path("dialogue").path(id);
      counts(s, "best", "loop", "line", "ticks", "wait", "busy", "talks");
      require(
          s.path("introduced").isBoolean()
              && s.path("pool").isArray()
              && s.path("flags").isObject());
      for (JsonNode quote : s.path("pool"))
        require(quote.isTextual() && !quoteLengths(id, quote.asText()).isEmpty());
      require(
          s.path("quote").isNull()
              || (s.path("quote").isTextual()
                  && s.path("line").asInt() < quoteLengths(id, s.path("quote").asText()).size()));
      s.path("flags")
          .properties()
          .forEach(
              entry ->
                  require(
                      entry.getKey().equals("CompletedNormalGame")
                          && !npc.path("flagQuotes").isEmpty()
                          && count(entry.getValue())));
    }
    for (JsonNode readable : data.path("readables")) {
      var s = saved.path("readables").path(readable.path("id").asText());
      counts(s, "wait", "line", "ticks");
      require(
          s.path("wait").asInt() <= tuning("readableWaitTicks")
              && s.path("line").asInt() < readable.path("lineLengths").size()
              && s.path("done").isBoolean());
    }
    for (String bird : List.of("raven", "whiteRaven")) {
      var raven = saved.path(bird);
      counts(raven, "index", "ticks");
      int last = data.path(bird).path("positions").size() - 1;
      require(
          raven.path("index").asInt() <= last
              && raven.path("flying").isBoolean()
              && raven.path("done").isBoolean());
      for (String field : List.of("x", "y", "vx", "vy"))
        require(
            raven.path(field).isNumber()
                && Double.isFinite(number(raven, field))
                && Math.abs(number(raven, field)) <= tuning("maxCounter"));
      require(
          !raven.path("done").asBoolean()
              || (raven.path("index").asInt() == last && !raven.path("flying").asBoolean()));
    }
    var next = JSON.objectNode().put("codecVersion", 2);
    var flags = next.putArray("flags");
    if (seen.contains("CompletedNormalGame")) flags.add("CompletedNormalGame");
    next.set("dialogue", saved.path("dialogue").deepCopy());
    next.set("readables", saved.path("readables").deepCopy());
    next.set("raven", saved.path("raven").deepCopy());
    next.set("whiteRaven", saved.path("whiteRaven").deepCopy());
    state = next;
  }
}
