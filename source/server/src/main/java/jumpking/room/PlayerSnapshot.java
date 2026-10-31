package jumpking.room;

import com.fasterxml.jackson.annotation.JsonInclude;
import jumpking.entity.Crown;
import jumpking.game.GameSimulation;
import jumpking.game.PlayerState;

/** Một bản chụp riêng cho mỗi player/đợt; owner và spectator dùng lại cùng dữ liệu bất biến. */
record PlayerSnapshot(GameSimulation.Snapshot simulation, PublicPlayer player) {
  record PublicPlayer(
      String playerId,
      String nickname,
      int colorSlot,
      String status,
      Pose state,
      Crown crown,
      long positionRevision) {}

  record Pose(
      double x,
      double y,
      double vx,
      double vy,
      boolean grounded,
      int charge,
      int direction,
      int splat,
      @JsonInclude(JsonInclude.Include.NON_DEFAULT) boolean slipping,
      boolean knocked,
      boolean snow,
      int screen,
      long ticks,
      int falls) {
    Pose(PlayerState value) {
      this(
          value.x,
          value.y,
          value.vx,
          value.vy,
          value.grounded,
          value.charge,
          value.direction,
          value.splat,
          value.slipping,
          value.knocked,
          value.snow,
          value.screen,
          value.ticks,
          value.falls);
    }
  }

  static PlayerSnapshot capture(
      GameSimulation game, String id, String nickname, int colorSlot, String status, Crown crown) {
    var saved = game.snapshot();
    return new PlayerSnapshot(
        saved,
        new PublicPlayer(
            id,
            nickname,
            colorSlot,
            status,
            new Pose(saved.physics()),
            crown,
            game.physics().positionRevision()));
  }

  int screen() {
    return simulation.physics().screen;
  }

  long ticks() {
    return simulation.physics().ticks;
  }
}
