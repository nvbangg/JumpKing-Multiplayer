package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;

/** Chỉ gửi state hiển thị, không gửi ACK, reconnect token hoặc checkpoint physics của mục tiêu. */
record SpectatorView(
    String playId,
    long elapsedTimeMs,
    boolean paused,
    PlayerSnapshot.PublicPlayer player,
    JsonNode adventure,
    JsonNode world) {
  static SpectatorView of(PlayerSnapshot saved, String playId, long elapsedTimeMs, boolean paused) {
    return new SpectatorView(
        playId,
        elapsedTimeMs,
        paused,
        saved.player(),
        saved.simulation().adventure(),
        saved.simulation().world());
  }
}
