package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.Map;
import java.util.concurrent.*;
import jumpking.JumpKingApplication;
import jumpking.network.SerialExecutor;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

@SpringBootTest(
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "app.allowed-origins=http://allowed.test,http://no-walk.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomNoWalkIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RoomManager server;
  @LocalServerPort int port;

  private void step(GameClient client, String play, int seq, int direction, boolean jump)
      throws Exception {
    client.input(
        Map.of(
            "playId",
            play,
            "generation",
            1,
            "seq",
            seq,
            "left",
            direction < 0,
            "right",
            direction > 0,
            "jump",
            jump));
    long elapsed =
        client.ok("GET_ROOM_STATE", Map.of()).path("currentPlay").path("elapsedTimeMs").asLong();
    time.advance(50);
    client.await(
        message ->
            message.path("type").asText().equals("GAME_SNAPSHOT")
                && message.path("payload").path("elapsedTimeMs").asLong() > elapsed);
  }

  @Test
  void groundIntentCannotWalkAfterLandingAndAirborneWallBounceRemainNative() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      var settings = new java.util.HashMap<String, Object>();
      settings.put("mode", "NO_WALK");
      settings.put("timeLimitMinutes", null);
      var host = a.ok("CREATE_ROOM", Map.of("settings", settings));
      String roomId = host.path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", roomId));
      a.ok("START_GAME", Map.of());
      String play =
          a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload")
              .path("playId")
              .asText();
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      int seq = 1;
      for (int i = 0; i < 10; i++) step(a, play, seq++, 1, false);
      var standing = a.snapshot().path("self").path("simulation").path("physics");
      assertThat(standing.path("x").asDouble()).isEqualTo(231);
      assertThat(standing.path("vx").asDouble()).isZero();
      for (int i = 0; i < 4; i++) step(a, play, seq++, 1, true);
      step(a, play, seq++, 1, false);
      var jumping = a.snapshot().path("self").path("simulation").path("physics");
      assertThat(jumping.path("jumps").asInt()).isEqualTo(1);
      assertThat(jumping.path("x").asDouble()).isGreaterThan(231);
      assertThat(jumping.path("vx").asDouble()).isEqualTo(3.5);
      for (int i = 0;
          i < 60
              && !a.snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("grounded")
                  .asBoolean();
          i++) step(a, play, seq++, 1, false);
      var landed = a.snapshot().path("self").path("simulation").path("physics");
      assertThat(landed.path("grounded").asBoolean()).isTrue();
      assertThat(landed.path("vx").asDouble()).isZero();
      assertThat(landed.path("falls").asInt()).isZero();
      for (int direction : new int[] {-1, 0, 1}) {
        for (int i = 0; i < 3; i++) step(a, play, seq++, direction, false);
        var stopped = a.snapshot().path("self").path("simulation").path("physics");
        assertThat(stopped.path("x").asDouble()).isEqualTo(landed.path("x").asDouble());
        assertThat(stopped.path("vx").asDouble()).isZero();
      }
      Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(roomId);
      var arranged = new CompletableFuture<Void>();
      ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
          .execute(
              () -> {
                try {
                  var match = (RoomMatch) ReflectionTestUtils.getField(room, "match");
                  var player = match.players.get(host.path("playerId").asText());
                  var pose = player.game.physics().snapshot();
                  pose.x = 451;
                  pose.y = 80;
                  pose.vx = 3.5;
                  pose.vy = 0;
                  pose.grounded = false;
                  pose.charge = 0;
                  player.game.physics().restore(pose);
                  arranged.complete(null);
                } catch (Throwable error) {
                  arranged.completeExceptionally(error);
                }
              });
      arranged.get(8, TimeUnit.SECONDS);
      step(a, play, seq++, 1, false);
      assertThat(a.snapshot().path("self").path("simulation").path("physics").path("vx").asDouble())
          .isNegative();
      a.ok("END_MATCH", Map.of());
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("SAVED"));
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject("SELECT mode FROM matches WHERE id=?", String.class, play))
          .isEqualTo("NO_WALK");
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }
}
