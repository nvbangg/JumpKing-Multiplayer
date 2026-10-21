package jumpking.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jumpking.game.GameSimulation;

/** Chỉ truyền dữ liệu hiển thị của mục tiêu, không có input ACK, token hoặc checkpoint physics. */
public final class SpectatorView {
  private SpectatorView() {}

  public static ObjectNode of(
      ObjectMapper json,
      ObjectNode player,
      String playId,
      long elapsedTimeMs,
      boolean paused,
      GameSimulation game) {
    var saved = game.snapshot();
    var view =
        json.createObjectNode()
            .put("playId", playId)
            .put("elapsedTimeMs", elapsedTimeMs)
            .put("paused", paused);
    view.set("player", player);
    view.set("adventure", saved.adventure());
    view.set("world", saved.world());
    return view;
  }
}
