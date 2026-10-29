package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
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
    properties = {
      "app.allowed-origins=http://allowed.test,http://again.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomAgainIT {
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

  private void ended(GameClient host) throws Exception {
    String id = host.ok("END_MATCH", Map.of()).path("playId").asText();
    host.await(
        message ->
            message.path("type").asText().equals("ROOM_STATE")
                && message.path("payload").path("result").path("playId").asText().equals(id)
                && message
                    .path("payload")
                    .path("result")
                    .path("saveStatus")
                    .asText()
                    .equals("SAVED"));
  }

  @Test
  void offlineUnconfirmedSlotDoesNotBlockTheConnectedHost() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port)) {
      for (var client : List.of(host, peer)) {
        client.register();
        client.connect();
      }
      var joined = host.ok("CREATE_ROOM", Map.of());
      peer.ok("JOIN_ROOM", Map.of("roomId", joined.path("roomId").asText()));
      peer.ok("SET_ROOM_CONFIRMED", Map.of("confirmed", false));
      peer.disconnect();
      host.await(
          m ->
              m.path("type").asText().equals("ROOM_STATE")
                  && m.path("payload").path("members").size() == 2
                  && !m.path("payload").path("members").get(1).path("connected").asBoolean());
      host.ok("START_GAME", Map.of());
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(1);
      host.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void oneConnectedHostCanStartSaveAndPlayAgainAlone() throws Exception {
    try (var host = new GameClient(port)) {
      host.register();
      host.connect();
      String room = host.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      var initial = host.ok("GET_ROOM_STATE", Map.of());
      assertThat(initial.path("members")).hasSize(1);
      assertThat(initial.path("members").get(0).path("nextMatchConfirmed").asBoolean()).isTrue();
      String first = started(host);
      ended(host);
      var history = host.request("/history", "GET", null).path("items");
      assertThat(history.size()).isEqualTo(1);
      assertThat(host.request("/history/ROOM/" + first, "GET", null).path("participants").size())
          .isEqualTo(1);
      host.ok("PLAY_AGAIN", Map.of("matchId", first));
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("roomId").asText()).isEqualTo(room);
      assertThat(started(host)).isNotEqualTo(first);
      ended(host);
      assertThat(host.request("/history", "GET", null).path("items").size()).isEqualTo(2);
      host.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void confirmationsPreserveCodeAndSettingsButOnlyConfirmedPlayersEnterTheNewRoster()
      throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port);
        var c = new GameClient(port);
        var d = new GameClient(port)) {
      for (var player : List.of(a, b, c, d)) {
        player.register();
        player.connect();
      }
      String room =
          a.ok("CREATE_ROOM", Map.of("settings", Map.of("mode", "RACE", "timeLimitMinutes", 8)))
              .path("roomId")
              .asText();
      var bJoined = b.ok("JOIN_ROOM", Map.of("roomId", room));
      c.ok("JOIN_ROOM", Map.of("roomId", room));
      String first = started(a);
      ended(a);
      assertThat(
              d.command("JOIN_ROOM", Map.of("roomId", room)).path("payload").path("code").asText())
          .isEqualTo("ROOM_NOT_JOINABLE");
      var waiting = b.ok("PLAY_AGAIN", Map.of("matchId", first));
      assertThat(waiting.path("state").asText()).isEqualTo("WAITING");
      assertThat(waiting.path("roomId").asText()).isEqualTo(room);
      assertThat(waiting.path("settings").path("timeLimitMinutes").asInt()).isEqualTo(8);
      assertThat(waiting.path("members").get(0).path("nextMatchJoined").asBoolean()).isFalse();
      assertThat(waiting.path("members").get(1).path("nextMatchJoined").asBoolean()).isTrue();
      b.ok("SET_ROOM_CONFIRMED", Map.of("confirmed", false));
      b.disconnect();
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("state").asText().equals("WAITING")
                  && message.path("payload").path("members").size() == 3
                  && !message.path("payload").path("members").get(1).path("connected").asBoolean());
      b.connect();
      b.ok(
          "RECONNECT",
          Map.of(
              "roomId", room,
              "playerId", bJoined.path("playerId").asText(),
              "reconnectToken", bJoined.path("reconnectToken").asText()));
      var cancelled = b.ok("GET_ROOM_STATE", Map.of()).path("members").get(1);
      assertThat(cancelled.path("nextMatchConfirmed").asBoolean()).isFalse();
      assertThat(cancelled.path("nextMatchJoined").asBoolean()).isTrue();
      assertThat(
              a.command("SET_ROOM_CONFIRMED", Map.of("confirmed", true))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      assertThat(a.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("NOT_ENOUGH_PLAYERS");
      assertThat(
              b.command("PLAY_AGAIN", Map.of("matchId", "wrong-match"))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("STALE_PLAY");
      d.ok("JOIN_ROOM", Map.of("roomId", room));
      a.ok("PLAY_AGAIN", Map.of("matchId", first));
      b.ok("PLAY_AGAIN", Map.of("matchId", first));
      String second = started(a);
      assertThat(second).isNotEqualTo(first);
      c.await(message -> message.path("type").asText().equals("ROOM_LEFT"));
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("members").size()).isEqualTo(3);
      ended(a);
      assertThat(a.request("/history", "GET", null).path("items").size()).isEqualTo(2);
      assertThat(c.request("/history", "GET", null).path("items").size()).isEqualTo(1);
      assertThat(d.request("/history", "GET", null).path("items").size()).isEqualTo(1);
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, second))
          .isEqualTo(3);
      for (var player : List.of(a, b, d)) player.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void retryingAFailedFinalSaveKeepsTheSameMatchBeforeAllowingConfirmation() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String trigger = "again_" + UUID.randomUUID().toString().replace("-", "");
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", room));
      String play = started(a);
      jdbc.execute(
          "CREATE TRIGGER "
              + trigger
              + " BEFORE UPDATE ON matches FOR EACH ROW BEGIN IF NEW.id='"
              + play
              + "' AND NEW.ended_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected final save failure'; END IF; END");
      a.ok("END_MATCH", Map.of());
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("FAILED"));
      jdbc.execute("DROP TRIGGER " + trigger);
      assertThat(a.ok("PLAY_AGAIN", Map.of("matchId", play)).path("state").asText())
          .isEqualTo("FINISHED");
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("SAVED"));
      var confirmed = a.ok("PLAY_AGAIN", Map.of("matchId", play));
      assertThat(confirmed.path("state").asText()).isEqualTo("WAITING");
      assertThat(confirmed.path("currentPlay").path("id").asText()).isEqualTo(play);
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, play))
          .isEqualTo(2);
      assertThat(
              jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, play))
          .isEqualTo("HOST_ENDED");
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    } finally {
      jdbc.execute("DROP TRIGGER IF EXISTS " + trigger);
    }
  }
}
