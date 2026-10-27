package jumpking.game;

/** Phạm vi mặt nền của đích Room ngắn, tính khi tạo simulation. */
record FinishPlatform(double x, double y, double width) {
  static FinishPlatform find(GameMap map, GameMap.Finish finish) {
    if (finish.minProgress() == 0) return null;
    double feetY = map.progressOriginY() - finish.minProgress();
    double rowIndex = (feetY + finish.screen() * map.screenHeight()) / map.tileSize();
    var tiles = map.screens().get(finish.screen()).tiles();
    int first = (int) Math.ceil(finish.minCenterX() / map.tileSize());
    if (rowIndex != Math.floor(rowIndex) || rowIndex < 1 || rowIndex >= tiles.size() || first < 0)
      return null;
    int row = (int) rowIndex, column = first;
    while (column < tiles.get(row).length()
        && "#IN".indexOf(tiles.get(row).charAt(column)) >= 0
        && tiles.get(row - 1).charAt(column) == ' ') column++;
    double end =
        Math.min(
            column * map.tileSize(),
            finish.maxCenterX() == null ? Double.POSITIVE_INFINITY : finish.maxCenterX());
    return end > first * map.tileSize()
        ? new FinishPlatform(first * map.tileSize(), feetY, end - first * map.tileSize())
        : null;
  }
}
