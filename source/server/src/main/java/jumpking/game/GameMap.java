package jumpking.game;

import java.util.List;

public record GameMap(
    int width,
    int screenHeight,
    int tileSize,
    double progressOriginY,
    Spawn spawn,
    Finish finish,
    List<Screen> screens,
    // Chặng Room 2–10: ranh giới dưới tại điểm bắt đầu; null với map đầy đủ.
    Double roomBottomY) {
  public record Spawn(double x, double y) {}

  public record Finish(
      int screen,
      double minCenterX,
      boolean requiresGrounded,
      double minProgress,
      Double maxCenterX) {}

  public record Screen(List<String> tiles, boolean wind) {
    public Screen {
      tiles = List.copyOf(tiles);
    }
  }

  public GameMap(
      int width,
      int screenHeight,
      int tileSize,
      double progressOriginY,
      Spawn spawn,
      Finish finish,
      List<Screen> screens) {
    this(width, screenHeight, tileSize, progressOriginY, spawn, finish, screens, null);
  }

  public GameMap {
    screens = List.copyOf(screens);
    if (width <= 0 || screenHeight <= 0 || tileSize <= 0 || screens.isEmpty())
      throw new IllegalArgumentException("Invalid map dimensions");
    for (Screen screen : screens) {
      if (screen.tiles().size() != screenHeight / tileSize
          || screen.tiles().stream()
              .anyMatch(row -> row.length() != width / tileSize || !row.matches("[ #INabcd]+")))
        throw new IllegalArgumentException("Invalid map tiles");
    }
  }
}
