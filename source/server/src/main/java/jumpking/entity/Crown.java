package jumpking.entity;

public enum Crown {
  NONE,
  GOLD,
  BLACK;

  public Crown finish(boolean ravenDone) {
    return this == BLACK || ravenDone ? BLACK : GOLD;
  }
}
