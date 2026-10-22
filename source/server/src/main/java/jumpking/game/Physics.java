package jumpking.game;

import java.util.Map;

public final class Physics {
  public final int bodyWidth,
      bodyHeight,
      tickRate,
      chargeTicks,
      directionBuffer,
      airGraceTicks,
      splatTicks,
      bumpQuietTicks,
      collisionRecoveryLimit;
  public final double walkSpeed,
      jumpSpeed,
      slipSpeedMultiplier,
      gravity,
      jumpVelocity,
      maxFall,
      bounce,
      iceFriction,
      iceAcceleration,
      snowMinimumCharge,
      snowLaunchCharge,
      windFrequency,
      windAcceleration,
      cameraMinimumRiseSpeed,
      flyHorizontalSpeed,
      flyVerticalSpeed;

  public Physics(Map<String, Number> values) {
    bodyWidth = integer(values, "bodyWidth");
    bodyHeight = integer(values, "bodyHeight");
    tickRate = integer(values, "tickRate");
    chargeTicks = integer(values, "chargeTicks");
    directionBuffer = integer(values, "directionBuffer");
    airGraceTicks = integer(values, "airGraceTicks");
    splatTicks = integer(values, "splatTicks");
    bumpQuietTicks = integer(values, "bumpQuietTicks");
    collisionRecoveryLimit = integer(values, "collisionRecoveryLimit");
    walkSpeed = number(values, "walkSpeed");
    slipSpeedMultiplier = number(values, "slipSpeedMultiplier");
    jumpSpeed = number(values, "jumpSpeed");
    maxFall = number(values, "maxFall");
    bounce = number(values, "bounce");
    iceFriction = number(values, "iceFriction");
    iceAcceleration = number(values, "iceAcceleration");
    snowMinimumCharge = number(values, "snowMinimumCharge");
    snowLaunchCharge = number(values, "snowLaunchCharge");
    windFrequency = number(values, "windFrequency");
    windAcceleration = number(values, "windAcceleration");
    cameraMinimumRiseSpeed = number(values, "cameraMinimumRiseSpeed");
    flyHorizontalSpeed = number(values, "flyHorizontalSpeed");
    flyVerticalSpeed = number(values, "flyVerticalSpeed");
    gravity = (float) (number(values, "gravityNumerator") / number(values, "gravityDenominator"));
    jumpVelocity = -(float) (number(values, "jumpGravityMultiplier") * gravity);
  }

  private static double number(Map<String, Number> values, String key) {
    Number value = values.get(key);
    if (value == null || !Double.isFinite(value.doubleValue()) || value.doubleValue() <= 0)
      throw new IllegalArgumentException("Invalid physics parameter: " + key);
    return value.doubleValue();
  }

  private static int integer(Map<String, Number> values, String key) {
    double value = number(values, key);
    if (value != Math.rint(value) || value > Integer.MAX_VALUE)
      throw new IllegalArgumentException("Invalid integer physics parameter: " + key);
    return (int) value;
  }
}
