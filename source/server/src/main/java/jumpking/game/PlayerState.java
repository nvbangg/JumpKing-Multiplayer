package jumpking.game;

import java.util.ArrayList;
import java.util.List;

public final class PlayerState {
  public int codecVersion;
  public double x, y, vx, vy;
  public boolean grounded;
  public int charge, direction;
  public boolean prevJump, jumpConsumed;
  public List<Integer> directions = new ArrayList<>();
  public int splat;

  @com.fasterxml.jackson.annotation.JsonInclude(
      com.fasterxml.jackson.annotation.JsonInclude.Include.NON_DEFAULT)
  public boolean slipping;

  @com.fasterxml.jackson.annotation.JsonInclude(
      com.fasterxml.jackson.annotation.JsonInclude.Include.NON_DEFAULT)
  public boolean jumpBoost;

  public boolean knocked, ice, snow, wind;
  public int screen;
  public long ticks;
  public int jumps, falls, airChargeTicks, bumpCooldownTicks;
  public boolean freeFlight, phasingFall;

  public PlayerState copy() {
    var copy = new PlayerState();
    copy.codecVersion = codecVersion;
    copy.x = x;
    copy.y = y;
    copy.vx = vx;
    copy.vy = vy;
    copy.grounded = grounded;
    copy.charge = charge;
    copy.direction = direction;
    copy.prevJump = prevJump;
    copy.jumpConsumed = jumpConsumed;
    copy.directions = new ArrayList<>(directions);
    copy.splat = splat;
    copy.slipping = slipping;
    copy.jumpBoost = jumpBoost;
    copy.knocked = knocked;
    copy.ice = ice;
    copy.snow = snow;
    copy.wind = wind;
    copy.screen = screen;
    copy.ticks = ticks;
    copy.jumps = jumps;
    copy.falls = falls;
    copy.airChargeTicks = airChargeTicks;
    copy.bumpCooldownTicks = bumpCooldownTicks;
    copy.freeFlight = freeFlight;
    copy.phasingFall = phasingFall;
    return copy;
  }
}
