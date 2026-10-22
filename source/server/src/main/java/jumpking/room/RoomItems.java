package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import java.util.random.RandomGenerator;
import jumpking.exception.ApiException;
import jumpking.game.*;

/** State item chỉ thuộc actor của Room; RNG và hit do server quyết định. */
final class RoomItems {
  enum Kind {
    BANANA,
    ROCK
  }

  static final class Slot {
    Kind held;
    boolean bananaArmed;
    long readyAt;
  }

  record Banana(long id, double x, double y, long armedAtTick) {}

  record Rock(long id, double x, double y, int direction, long tick) {}

  record View(
      Kind held, boolean bananaArmed, long cooldownMs, List<Banana> bananas, List<Rock> rocks) {}

  final Map<String, Slot> slots = new LinkedHashMap<>();
  private final List<Banana> bananas = new ArrayList<>();
  private final List<Rock> rocks = new ArrayList<>();
  private final Physics p;
  private final RandomGenerator random;
  private final double width;
  private final int rockEffectTicks, maximumBananas;
  private long sequence;

  RoomItems(Physics p, JsonNode rules, RandomGenerator random) {
    this.p = p;
    this.random = random;
    width = rules.path("bananaWidth").asDouble();
    rockEffectTicks = rules.path("rockEffectTicks").asInt();
    maximumBananas = rules.path("maximumBananas").asInt();
    if (maximumBananas < 1) throw new IllegalArgumentException("Banana limit must be positive");
  }

  void start(Collection<String> players) {
    for (var id : players) {
      var slot = new Slot();
      grant(slot);
      slots.put(id, slot);
    }
  }

  private void grant(Slot slot) {
    slot.held = random.nextBoolean() ? Kind.BANANA : Kind.ROCK;
    slot.bananaArmed = false;
  }

  void advance(long tick) {
    slots.values().stream().filter(s -> s.held == null && tick >= s.readyAt).forEach(this::grant);
    rocks.removeIf(r -> tick - r.tick >= rockEffectTicks);
  }

  private void consume(Slot slot, long tick, int cooldownMinutes) {
    slot.held = null;
    slot.bananaArmed = false;
    slot.readyAt = tick + cooldownMinutes * 60L * p.tickRate;
  }

  void use(
      String id, Simulation own, Map<String, Simulation> targets, long tick, int cooldownMinutes) {
    var slot = slots.get(id);
    if (slot == null || slot.held == null)
      throw new ApiException(409, "ITEM_COOLDOWN", "Item is not ready");
    if (slot.held == Kind.BANANA && slot.bananaArmed) {
      slot.bananaArmed = false;
      return;
    }
    var state = own.snapshot();
    if (state.freeFlight
        || state.phasingFall
        || state.slipping
        || state.splat > 0
        || state.charge > 0)
      throw new ApiException(409, "ITEM_UNAVAILABLE", "Item cannot be used right now");
    if (slot.held == Kind.BANANA) {
      if (bananas.size() >= maximumBananas)
        throw new ApiException(409, "ITEM_UNAVAILABLE", "The room has reached its banana limit");
      if (!state.grounded || state.vy < 0)
        throw new ApiException(
            409, "INVALID_ITEM_POSITION", "Stand on the ground to prepare a banana");
      slot.bananaArmed = true;
      return;
    }
    Simulation target = null;
    double highest = -1;
    // Map theo roster: cùng độ cao giữ mục tiêu gặp trước, không dùng peak/last landing.
    for (var entry : targets.entrySet()) {
      var candidate = entry.getValue();
      var pose = candidate.snapshot();
      if (entry.getKey().equals(id) || pose.freeFlight || pose.phasingFall || pose.splat > 0)
        continue;
      double height = candidate.progress();
      if (height > highest) {
        highest = height;
        target = candidate;
      }
    }
    if (target == null)
      throw new ApiException(409, "NO_ITEM_TARGET", "No other player is available");
    var pose = target.snapshot();
    int direction = pose.x == state.x ? state.direction : (int) Math.signum(pose.x - state.x);
    target.slip(direction, true);
    rocks.add(
        new Rock(
            ++sequence, pose.x + p.bodyWidth / 2.0, pose.y + p.bodyHeight / 2.0, direction, tick));
    consume(slot, tick, cooldownMinutes);
  }

  void takeoff(String id, Simulation simulation, long tick, int cooldownMinutes) {
    var slot = slots.get(id);
    if (slot == null || !slot.bananaArmed || slot.held != Kind.BANANA) return;
    var state = simulation.snapshot();
    slot.bananaArmed = false;
    // Người khác có thể đặt bẫy sau lúc chuẩn bị; kiểm tra lại trước khi tiêu thụ item.
    if (bananas.size() >= maximumBananas) return;
    // JUMP có thể là air grace; chỉ đặt tại cú bật nhảy thật trên mặt nền.
    if (!state.grounded || state.freeFlight || state.phasingFall) return;
    double x = state.x + p.bodyWidth / 2.0, y = state.y + p.bodyHeight;
    if (bananas.stream().anyMatch(b -> Math.abs(b.x - x) < width && Math.abs(b.y - y) < 2)) return;
    bananas.add(new Banana(++sequence, x, y, tick + 1));
    consume(slot, tick, cooldownMinutes);
  }

  void hit(Simulation simulation, long tick) {
    var state = simulation.snapshot();
    if (!state.grounded
        || state.vy < 0
        || state.freeFlight
        || state.phasingFall
        || state.slipping
        || state.splat > 0) return;
    var iterator = bananas.iterator();
    while (iterator.hasNext()) {
      var b = iterator.next();
      if (tick >= b.armedAtTick
          && Math.abs(state.y + p.bodyHeight - b.y) <= 2
          && state.x + p.bodyWidth > b.x - width / 2
          && state.x < b.x + width / 2) {
        iterator.remove();
        simulation.slip(state.vx == 0 ? state.direction : (int) Math.signum(state.vx), false);
        return;
      }
    }
  }

  private boolean nearby(double y, int screen, int screenHeight) {
    return Math.abs(Math.max(0, (int) -Math.floor(y / screenHeight)) - screen) <= 1;
  }

  View view(String id, long tick, int screen, int screenHeight) {
    var slot = slots.get(id);
    return new View(
        slot == null ? null : slot.held,
        slot != null && slot.bananaArmed,
        slot == null || slot.held != null
            ? 0
            : Math.max(0, slot.readyAt - tick) * 1000 / p.tickRate,
        bananas.stream().filter(b -> nearby(b.y, screen, screenHeight)).toList(),
        rocks.stream().filter(r -> nearby(r.y, screen, screenHeight)).toList());
  }

  void clear() {
    slots.clear();
    bananas.clear();
    rocks.clear();
  }
}
