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
      "app.allowed-origins=http://allowed.test,http://hardcore.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomHardcoreIT {
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

  @Test
  void aNativeSplatRespawnsOnlyItsPlayerAndKeepsClockPeakAndAllCounters() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      var settings = new java.util.HashMap<String, Object>();
      settings.put("mode", "HARDCORE");
      settings.put("timeLimitMinutes", null);
      var member = a.ok("CREATE_ROOM", Map.of("settings", settings));
      String roomId = member.path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", roomId));
      a.ok("START_GAME", Map.of());
      String play =
          a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload")
              .path("playId")
              .asText();
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(roomId);
      var arranged = new CompletableFuture<Void>();
      ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
          .execute(
              () -> {
                try {
                  var match = (RoomMatch) ReflectionTestUtils.getField(room, "match");
                  var player = match.players.get(member.path("playerId").asText());
                  var pose = player.game.physics().snapshot();
                  pose.x = 231;
                  pose.y = 280;
                  pose.vx = 0;
                  pose.vy = 10;
                  pose.grounded = false;
                  pose.jumps = 3;
                  pose.falls = 2;
                  player.game.physics().restore(pose);
                  player.maximum = 500;
                  player.peak = pose.ticks;
                  arranged.complete(null);
                } catch (Throwable error) {
                  arranged.completeExceptionally(error);
                }
              });
      arranged.get(8, TimeUnit.SECONDS);
      time.advance(100);
      var reset =
          a.await(
                  message ->
                      message.path("type").asText().equals("GAME_SNAPSHOT")
                          && message
                                  .path("payload")
                                  .path("self")
                                  .path("simulation")
                                  .path("physics")
                                  .path("falls")
                                  .asInt()
                              == 3)
              .path("payload");
      var pose = reset.path("self").path("simulation").path("physics");
      assertThat(pose.path("y").asDouble()).isEqualTo(302);
      assertThat(pose.path("x").asDouble()).isEqualTo(231);
      assertThat(pose.path("splat").asInt()).isZero();
      assertThat(pose.path("jumps").asInt()).isEqualTo(3);
      assertThat(reset.path("self").path("metrics").path("maxProgress").asDouble()).isEqualTo(500);
      assertThat(reset.path("elapsedTimeMs").asLong()).isPositive();
      assertThat(reset.path("self").path("status").asText()).isEqualTo("ACTIVE");
      assertThat(reset.path("peers").get(0).path("state").path("falls").asInt()).isZero();
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
      var jdbc = TestDatabase.get().jdbc;
      assertThat(
              jdbc.queryForObject(
                  "SELECT falls FROM play_runs WHERE match_id=? AND user_id=?",
                  Integer.class,
                  play,
                  a.owner))
          .isEqualTo(3);
      assertThat(
              jdbc.queryForObject(
                  "SELECT max_progress FROM play_runs WHERE match_id=? AND user_id=?",
                  Double.class,
                  play,
                  a.owner))
          .isEqualTo(500);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }
}
