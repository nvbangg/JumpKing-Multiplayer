package jumpking.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "app.checkpoint-interval-ms=25"})
class RoomPauseIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @LocalServerPort int port;

  private String started(GameClient host) throws Exception {
    host.ok("START_GAME", Map.of());
    String id =
        host.await(message -> message.path("type").asText().equals("GAME_STARTED"))
            .path("payload")
            .path("playId")
            .asText();
    time.advance(3000);
    host.await(
        message ->
            message.path("type").asText().equals("GAME_SNAPSHOT")
                && message.path("payload").path("playId").asText().equals(id));
    return id;
  }

  @Test
  void hostCanPauseAndResumeRoomMatchAndNonHostIsForbidden() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port)) {
      host.register();
      peer.register();
      host.connect();
      peer.connect();

      var room = host.ok("CREATE_ROOM", Map.of());
      String roomId = room.path("roomId").asText();
      peer.ok("JOIN_ROOM", Map.of("roomId", roomId));
      // Tạm dừng khi phòng còn WAITING phải bị từ chối.
      var earlyPause = host.command("SET_ROOM_PAUSED", Map.of("paused", true));
      assertThat(earlyPause.path("payload").path("code").asText()).isEqualTo("CONFLICT");

      started(host);

      // Thành viên không phải Host không được tạm dừng trận.
      var peerAttempt = peer.command("SET_ROOM_PAUSED", Map.of("paused", true));
      assertThat(peerAttempt.path("payload").path("code").asText()).isEqualTo("FORBIDDEN");

      // Host tạm dừng trận thành công.
      var pauseResult = host.ok("SET_ROOM_PAUSED", Map.of("paused", true));
      assertThat(pauseResult.path("state").asText()).isEqualTo("PAUSED");
      long pausedElapsed = pauseResult.path("currentPlay").path("elapsedTimeMs").asLong();

      // Thành viên khác nhận snapshot báo đang tạm dừng.
      var peerSnapshot =
          peer.await(
              message ->
                  message.path("type").asText().equals("GAME_SNAPSHOT")
                      && message.path("payload").path("self").path("paused").asBoolean());
      assertThat(peerSnapshot).isNotNull();

      time.advance(5000);
      assertThat(
              host.ok("GET_ROOM_STATE", Map.of())
                  .path("currentPlay")
                  .path("elapsedTimeMs")
                  .asLong())
          .isEqualTo(pausedElapsed);

      // Host tiếp tục trận thành công.
      peer.messages.clear();
      var resumeResult = host.ok("SET_ROOM_PAUSED", Map.of("paused", false));
      assertThat(resumeResult.path("state").asText()).isEqualTo("PLAYING");

      // Thành viên khác nhận snapshot báo trận đã tiếp tục.
      var peerResumedSnapshot =
          peer.await(
              message ->
                  message.path("type").asText().equals("GAME_SNAPSHOT")
                      && !message.path("payload").path("self").path("paused").asBoolean());
      assertThat(peerResumedSnapshot).isNotNull();
      long resumedElapsed = resumeResult.path("currentPlay").path("elapsedTimeMs").asLong();
      time.advance(250);
      host.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message.path("payload").path("elapsedTimeMs").asLong() > resumedElapsed);

      // Host vẫn có thể kết thúc trận khi đang tạm dừng.
      host.ok("SET_ROOM_PAUSED", Map.of("paused", true));
      var endResult = host.ok("END_MATCH", Map.of());
      assertThat(endResult.path("reason").asText()).isEqualTo("HOST_ENDED");
    }
  }
}
