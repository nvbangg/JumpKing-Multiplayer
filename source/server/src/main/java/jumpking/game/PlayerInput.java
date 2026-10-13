package jumpking.game;

public record PlayerInput(
    boolean left, boolean right, boolean jump, boolean up, boolean down, Boolean freeFlight) {
  public static final PlayerInput NEUTRAL = new PlayerInput(false, false, false);

  public PlayerInput(boolean left, boolean right, boolean jump) {
    this(left, right, jump, false, false, null);
  }
}
