package jumpking.game;

import java.util.ArrayList;
import java.util.List;

public final class Simulation {
  private final GameMap map;
  private final Physics p;
  private final boolean flyAllowed;
  private final boolean noWalk;
  private PlayerState state;
  private static final double SQRT_HALF = Math.sqrt(0.5);

  private static double f(double value) {
    return (float) value;
  }

  private static double clamp(double value, double low, double high) {
    return Math.max(low, Math.min(high, value));
  }

  private static double towards(double value, double target, double amount) {
    return value + clamp(target - value, -amount, amount);
  }

  public Simulation(GameMap map, Physics physics, boolean flyAllowed, boolean noWalk) {
    this.map = map;
    this.p = physics;
    this.flyAllowed = flyAllowed;
    this.noWalk = noWalk;
    state = initialState();
  }

  private PlayerState initialState() {
    var s = new PlayerState();
    s.codecVersion = 1;
    s.x = map.spawn().x();
    s.y = map.spawn().y();
    s.vy = 1;
    s.grounded = true;
    s.direction = 1;
    return s;
  }

  public PlayerState snapshot() {
    return state.copy();
  }

  public void restore(PlayerState saved) {
    if (saved.codecVersion != 1
        || saved.directions == null
        || saved.directions.size() > p.directionBuffer
        || saved.directions.stream().anyMatch(value -> value == null || value < -1 || value > 1)
        || !Double.isFinite(saved.x)
        || !Double.isFinite(saved.y)
        || !Double.isFinite(saved.vx)
        || !Double.isFinite(saved.vy)
        || saved.ticks < 0
        || saved.ticks > 9007199254740991L
        || saved.jumps < 0
        || saved.falls < 0
        || saved.charge < 0
        || saved.charge > p.chargeTicks
        || saved.splat < 0
        || saved.splat > p.splatTicks
        || saved.screen < 0
        || saved.screen >= map.screens().size()
        || saved.airChargeTicks < 0
        || saved.bumpCooldownTicks < 0
        || Math.abs(saved.direction) != 1
        || saved.x < -p.bodyWidth / 2.0
        || saved.x > map.width() - p.bodyWidth / 2.0
        || saved.y < -(double) map.screenHeight() * map.screens().size()
        || saved.y > map.screenHeight())
      throw new IllegalArgumentException("Invalid simulation snapshot");
    state = saved.copy();
    if (!flyAllowed && state.freeFlight) setFlight(false);
  }

  public void cancelInput() {
    state.charge = 0;
    state.directions.clear();
    state.airChargeTicks = 0;
    state.prevJump = false;
    state.jumpConsumed = true;
  }

  public void respawn() {
    long ticks = state.ticks;
    int jumps = state.jumps, falls = state.falls;
    state = initialState();
    state.ticks = ticks;
    state.jumps = jumps;
    state.falls = falls;
  }

  public void setFlight(boolean enabled) {
    if (enabled && !flyAllowed) throw new IllegalArgumentException("Fly mode is disabled");
    if (state.freeFlight == enabled) return;
    state.freeFlight = enabled;
    state.vx = 0;
    state.vy = 0;
    state.grounded = false;
    state.phasingFall = !enabled && contact().solid;
    state.splat = 0;
    state.knocked = false;
    state.ice = false;
    state.snow = false;
    state.wind = false;
    cancelInput();
  }

  public double progress() {
    return Math.max(0, map.progressOriginY() - state.y - p.bodyHeight);
  }

  public boolean finished() {
    return state.screen == map.finish().screen()
        && state.grounded
        && state.x + p.bodyWidth / 2.0 >= map.finish().minCenterX()
        && progress() >= map.finish().minProgress();
  }

  private int screenAt(double y) {
    return (int) clamp(-Math.floor(y / map.screenHeight()), 0, map.screens().size() - 1);
  }

  private static final class Contact {
    boolean solid, ice, snow;
    char slope;
  }

  private Contact contact() {
    int x = (int) state.x, y = (int) state.y;
    int right = x + p.bodyWidth,
        bottom = y + p.bodyHeight,
        size = map.tileSize(),
        rows = map.screenHeight() / size;
    var info = new Contact();
    double nearest = Double.POSITIVE_INFINITY,
        solidTop = Double.POSITIVE_INFINITY,
        slopeTop = Double.POSITIVE_INFINITY;
    for (int ty = Math.floorDiv(y, size); ty <= Math.floorDiv(bottom - 1, size); ty++) {
      int screenIndex = -Math.floorDiv(ty, rows);
      if (screenIndex < 0 || screenIndex >= map.screens().size()) continue;
      String row = map.screens().get(screenIndex).tiles().get(ty + screenIndex * rows);
      for (int tx = Math.max(0, Math.floorDiv(x, size));
          tx <= Math.min(map.width() / size - 1, Math.floorDiv(right - 1, size));
          tx++) {
        char code = row.charAt(tx);
        int px = tx * size, py = ty * size;
        if (code == ' ') continue;
        int left = Math.max(x, px) - px, top = Math.max(y, py) - py;
        int r = Math.min(right, px + size) - px, b = Math.min(bottom, py + size) - py;
        if ((code == 'a' && r + b < size)
            || (code == 'b' && b < left)
            || (code == 'c' && top > r)
            || (code == 'd' && left + top > size)) continue;
        info.solid = true;
        info.ice |= code == 'I';
        info.snow |= code == 'N';
        if ("abcd".indexOf(code) >= 0) {
          slopeTop = Math.min(slopeTop, py);
          double distance = Math.abs(px + size / 2.0 - (x + p.bodyWidth / 2.0));
          if (distance <= nearest) {
            nearest = distance;
            info.slope = code;
          }
        } else solidTop = Math.min(solidTop, py);
      }
    }
    if (solidTop <= slopeTop && (info.slope == 'a' || info.slope == 'b')) info.slope = 0;
    return info;
  }

  private boolean projectSlope(char code) {
    double nx = code == 'a' || code == 'c' ? -SQRT_HALF : SQRT_HALF;
    double ny = code == 'a' || code == 'b' ? -SQRT_HALF : SQRT_HALF;
    double dot = state.vx * nx + state.vy * ny;
    if (dot < 0) {
      state.vx = f(state.vx - dot * nx);
      state.vy = f(state.vy - dot * ny);
    }
    return dot < 0;
  }

  private boolean move() {
    var s = state;
    var info = contact();
    if (!map.screens().get(s.screen).wind()) s.wind = false;
    else if (s.grounded) s.wind = true;
    if (s.wind && !s.snow) {
      double phase = (double) s.ticks / p.tickRate * p.windFrequency;
      s.vx =
          f(
              s.vx
                  + clamp(2 * Math.sin(phase) + (Math.cos(phase) > 0 ? 1 : -1), -1, 1)
                      * p.windAcceleration);
    }
    double vx = s.vx, vy = s.vy;
    boolean wasGrounded = s.grounded;
    if (info.solid) {
      s.x = f(s.x + vx);
      s.y = f(s.y + vy);
      return false;
    }
    boolean sideSlope = false, bumped = false;
    s.x = clamp(f(s.x + vx), -p.bodyWidth / 2.0, map.width() - p.bodyWidth / 2.0);
    info = contact();
    if (info.solid) {
      s.x = (int) s.x;
      int sign = vx > 0 ? 1 : -1;
      for (int attempts = 0; attempts < p.collisionRecoveryLimit; attempts++) {
        var next = contact();
        if (!next.solid) break;
        info = next;
        s.x -= sign;
      }
      if (info.slope == 0) {
        s.vx = f(-s.vx * p.bounce);
        s.knocked = true;
        bumped = true;
      } else {
        sideSlope = true;
        if (wasGrounded && Math.abs(vx) <= p.walkSpeed && vy > 0) s.vx = 0;
        else projectSlope(info.slope);
      }
    }
    int signY = s.vy > 0 ? 1 : -1;
    s.y = f(s.y + s.vy);
    if (wasGrounded && s.vy > 0) s.y++;
    info = contact();
    s.snow = false;
    if (info.solid) {
      s.y = (int) s.y;
      for (int attempts = 0; attempts < p.collisionRecoveryLimit; attempts++) {
        var next = contact();
        if (!next.solid) break;
        info = next;
        s.y -= signY;
      }
      s.ice = info.ice;
      if (signY > 0) {
        s.grounded = info.slope == 0;
        if (info.slope != 0) s.knocked = projectSlope(info.slope);
        else {
          s.knocked = false;
          s.snow = info.snow;
          if (vy == p.maxFall && s.splat == 0) {
            s.splat = p.splatTicks;
            s.falls++;
          }
        }
      } else {
        bumped = true;
        if (info.slope != 0) projectSlope(info.slope);
        s.vx = f(s.vx * p.bounce);
      }
      if (info.slope == 0 || s.vy <= 0 || s.grounded) s.vy = 0;
    } else {
      s.grounded = false;
      s.ice = false;
      if (sideSlope && signY > 0 && !s.knocked) {
        s.vx = f(-s.vx * p.bounce);
        s.knocked = true;
        bumped = true;
      }
    }
    s.vy = Math.min(f(s.vy + p.gravity), p.maxFall);
    if (s.ice) s.vx = f(towards(s.vx, 0, p.iceFriction));
    return bumped;
  }

  public List<String> tick(PlayerInput input) {
    var s = state;
    if (input.freeFlight() != null && input.freeFlight() != s.freeFlight)
      setFlight(input.freeFlight());
    if (s.freeFlight) {
      s.vx = ((input.right() ? 1 : 0) - (input.left() ? 1 : 0)) * p.flySpeed;
      s.vy = ((input.down() ? 1 : 0) - (input.up() ? 1 : 0)) * p.flySpeed;
      s.x = clamp(f(s.x + s.vx), 0, map.width() - p.bodyWidth);
      s.y =
          clamp(
              f(s.y + s.vy),
              -(map.screens().size() - 1.0) * map.screenHeight(),
              map.screenHeight() - p.bodyHeight);
      if (s.vx != 0) s.direction = (int) Math.signum(s.vx);
      s.screen = screenAt(s.y + p.bodyHeight / 2.0);
      s.ticks++;
      return List.of();
    }
    if (s.phasingFall) {
      s.vx = 0;
      s.vy = Math.min(f(s.vy + p.gravity), p.maxFall);
      s.y = f(s.y + s.vy);
      s.ticks++;
      s.screen = screenAt(s.y + p.bodyHeight / 2.0);
      if (s.y >= map.screenHeight() - p.bodyHeight) respawn();
      else if (!contact().solid) s.phasingFall = false;
      return List.of();
    }
    int jumps = s.jumps, falls = s.falls;
    boolean grounded = s.grounded;
    boolean bumped = move();
    s.ticks++;
    int intent = (input.right() ? 1 : 0) - (input.left() ? 1 : 0);
    if (!input.jump()) s.jumpConsumed = false;
    s.prevJump = input.jump();
    if (s.splat > 0) {
      if (!s.ice) s.vx = 0;
      if (s.grounded) s.splat--;
      if (s.splat == 0 && intent == 0 && !input.jump()) s.splat = 1;
      s.charge = 0;
    } else if (s.grounded || (s.charge > 0 && s.airChargeTicks < p.airGraceTicks)) {
      s.airChargeTicks = s.grounded ? 0 : s.airChargeTicks + 1;
      if (s.charge > 0 || (input.jump() && !s.jumpConsumed)) {
        s.directions.addFirst(intent);
        if (s.directions.size() > p.directionBuffer) s.directions.removeLast();
        if (!s.ice && s.grounded) s.vx = 0;
        s.charge++;
        if (s.charge >= p.chargeTicks || !input.jump()) {
          double intensity = Math.min(1, (double) s.charge / p.chargeTicks);
          int direction =
              intent != 0
                  ? intent
                  : s.directions.stream().filter(value -> value != 0).findFirst().orElse(0);
          if (!s.snow || intensity > p.snowMinimumCharge) {
            if (s.snow && intensity < p.snowLaunchCharge) intensity = p.snowLaunchCharge;
            s.vy = f(p.jumpVelocity * intensity);
            s.vx = f(clamp(s.vx + direction * p.jumpSpeed, -p.jumpSpeed, p.jumpSpeed));
            if (direction != 0) s.direction = direction;
            s.jumps++;
          }
          s.charge = 0;
          s.directions.clear();
          s.jumpConsumed = true;
        }
      } else {
        if (s.snow) s.vx = 0;
        else if (!noWalk) {
          double target = intent * p.walkSpeed;
          if (!s.ice) s.vx = target;
          else if (intent != 0
              && (Math.signum(target) != Math.signum(s.vx) || Math.abs(target) > Math.abs(s.vx)))
            s.vx = f(towards(s.vx, target, p.iceAcceleration));
        }
        if (intent != 0) s.direction = intent;
      }
    } else {
      s.charge = 0;
      s.directions.clear();
      s.airChargeTicks = 0;
    }
    int next = screenAt(s.y + p.bodyHeight / 2.0);
    if (next != s.screen
        && s.vy != 0
        && Math.signum(next - s.screen) == Math.signum(-s.vy)
        && !(s.vy < 0 && Math.abs(s.vy) < p.cameraMinimumRiseSpeed)) {
      if (next < s.screen && map.screens().get(next).wind()) s.wind = true;
      s.screen = next;
    }
    var effects = new ArrayList<String>();
    if (s.jumps > jumps) effects.add("JUMP");
    if (s.falls > falls) effects.add("SPLAT");
    else if (!grounded && s.grounded) effects.add("LAND");
    if (bumped) {
      if (s.bumpCooldownTicks == 0) effects.add("BUMP");
      s.bumpCooldownTicks = p.bumpQuietTicks;
    } else s.bumpCooldownTicks = Math.max(0, s.bumpCooldownTicks - 1);
    return List.copyOf(effects);
  }
}
