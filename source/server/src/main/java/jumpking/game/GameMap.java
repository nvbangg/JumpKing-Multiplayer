package jumpking.game;

import java.util.List;

public record GameMap(
    int width,
    int screenHeight,
    int tileSize,
    double progressOriginY,
    Spawn spawn,
    Finish finish,
    List<Screen> screens) {
  public record Spawn(double x, double y) {}

  public record Finish(
      int screen, double minCenterX, boolean requiresGrounded, double minProgress) {}

  public record Screen(List<String> tiles, boolean wind) {
    public Screen {
      tiles = List.copyOf(tiles);
    }
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
