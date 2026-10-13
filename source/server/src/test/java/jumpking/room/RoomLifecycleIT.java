package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.CookieManager;
import java.util.Map;
import java.util.concurrent.*;
import jumpking.JumpKingApplication;
import jumpking.network.SerialExecutor;
import jumpking.security.SessionAuthority;
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
      "app.allowed-origins=http://allowed.test,http://lifecycle.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomLifecycleIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RaceRoom server;
  @Autowired Memberships memberships;
  @Autowired SessionAuthority sessions;
  @LocalServerPort int port;

  private record Started(String room, String play, JsonNode first, JsonNode second) {}

  private Started start(GameClient a, GameClient b) throws Exception {
    a.connect();
    b.connect();
    var first = a.ok("CREATE_ROOM", Map.of());
    String room = first.path("roomId").asText();
    var second = b.ok("JOIN_ROOM", Map.of("roomId", room));
    a.ok("START_GAME", Map.of());
    String play =
        a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
            .path("payload")
            .path("playId")
            .asText();
    time.advance(3000);
    a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
    return new Started(room, play, first, second);
  }

  private Map<String, String> reconnect(Started game, JsonNode player) {
    return Map.of(
        "roomId",
        game.room,
        "playerId",
        player.path("playerId").asText(),
        "reconnectToken",
        player.path("reconnectToken").asText());
  }

  private JsonNode state(String id) throws Exception {
    Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(id);
    var result = new CompletableFuture<JsonNode>();
    ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
        .execute(() -> result.complete(ReflectionTestUtils.invokeMethod(server, "state", room)));
    return result.get(8, TimeUnit.SECONDS);
  }

  private void end(GameClient host) throws Exception {
    host.ok("END_MATCH", Map.of());
    host.await(
        message ->
            message.path("type").asText().equals("ROOM_STATE")
                && message
                    .path("payload")
                    .path("result")
                    .path("saveStatus")
                    .asText()
                    .equals("SAVED"));
  }

  @Test
  void hostTransfersImmediatelyReconnectCannotReclaimHostAndTheDeadlineIsFiveMinutes()
      throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      var game = start(a, b);
      a.disconnect();
      b.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("hostPlayerId")
                      .asText()
                      .equals(game.second.path("playerId").asText()));
      a.connect();
      assertThat(a.ok("RECONNECT", reconnect(game, game.first)).path("generation").asLong())
          .isEqualTo(2);
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("hostPlayerId").asText())
          .isEqualTo(game.second.path("playerId").asText());
      assertThat(
              b.command("RECONNECT", reconnect(game, game.first))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("INVALID_RECONNECT");
      a.input(
          Map.of(
              "playId",
              game.play,
              "generation",
              1,
              "seq",
              1,
              "left",
              false,
              "right",
              false,
              "jump",
              false));
      a.await(
          message ->
              message.path("type").asText().equals("ERROR")
                  && message.path("payload").path("code").asText().equals("STALE_PLAY"));
      b.messages.clear();
      a.disconnect();
      b.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && !message.path("payload").path("members").get(0).path("connected").asBoolean());
      time.advance(299999);
      Thread.sleep(50);
      assertThat(memberships.find(a.owner)).isNotNull();
      time.advance(1);
      GameClient.until(() -> memberships.find(a.owner) == null);
      a.connect();
      assertThat(a.command("RECONNECT", reconnect(game, game.first)).path("type").asText())
          .isEqualTo("ERROR");
      end(b);
      var history = a.request("/history/ROOM/" + game.play, "GET", null);
      assertThat(history.path("participants").get(0).path("nickname").asText()).isNotBlank();
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND user_id=? AND status='DNF'",
                      Integer.class,
                      game.play,
                      a.owner))
          .isEqualTo(1);
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void everyPlayerOfflineFreezesTheClockThenFinalizesOnceAtTheLastDeadline() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      var game = start(a, b);
      a.disconnect();
      b.disconnect();
      GameClient.until(
          () -> {
            try {
              return state(game.room).path("hostPlayerId").isNull();
            } catch (Exception error) {
              throw new IllegalStateException(error);
            }
          });
      long frozen = state(game.room).path("currentPlay").path("elapsedTimeMs").asLong();
      time.advance(120000);
      Thread.sleep(50);
      assertThat(state(game.room).path("currentPlay").path("elapsedTimeMs").asLong())
          .isEqualTo(frozen);
      a.connect();
      a.ok("RECONNECT", reconnect(game, game.first));
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("hostPlayerId").asText())
          .isEqualTo(game.first.path("playerId").asText());
      a.disconnect();
      GameClient.until(
          () -> {
            try {
              return state(game.room).path("hostPlayerId").isNull();
            } catch (Exception error) {
              throw new IllegalStateException(error);
            }
          });
      time.advance(180000);
      GameClient.until(() -> memberships.find(b.owner) == null);
      assertThat(memberships.find(a.owner)).isNotNull();
      time.advance(120000);
      GameClient.until(() -> memberships.find(a.owner) == null);
      GameClient.until(
          () ->
              TestDatabase.get()
                      .jdbc
                      .queryForObject(
                          "SELECT COUNT(*) FROM matches WHERE id=? AND end_reason='ALL_DISCONNECTED'",
                          Integer.class,
                          game.play)
                  == 1);
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='DNF' AND is_winner=FALSE",
                      Integer.class,
                      game.play))
          .isEqualTo(2);
      a.connect();
      assertThat(
              a.command("RECONNECT", reconnect(game, game.first))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("RECONNECT_EXPIRED");
    }
  }

  @Test
  void aRevokedSessionCanLoginToTheSameAccountAndReconnectWithoutResettingTheMatch()
      throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      String username =
          a.request("/auth/me", "GET", null).path("account").path("username").asText();
      var game = start(a, b);
      var cookies = (CookieManager) a.http.cookieHandler().orElseThrow();
      String sessionId =
          cookies.getCookieStore().getCookies().stream()
              .filter(cookie -> cookie.getName().equals("JSESSIONID"))
              .findFirst()
              .orElseThrow()
              .getValue();
      sessions.find(sessionId).invalidate();
      b.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("hostPlayerId")
                      .asText()
                      .equals(game.second.path("playerId").asText()));
      a.disconnect();
      a.login(username, "A secure server integration password");
      a.connect();
      assertThat(a.ok("RECONNECT", reconnect(game, game.first)).path("playId").asText())
          .isEqualTo(game.play);
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("members").size()).isEqualTo(2);
      end(b);
      assertThat(a.request("/history", "GET", null).path("items").get(0).path("id").asText())
          .isEqualTo(game.play);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }
}
