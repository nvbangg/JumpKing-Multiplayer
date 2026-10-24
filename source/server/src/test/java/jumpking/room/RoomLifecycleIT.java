package jumpking.room;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

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
  @Autowired RoomManager server;
  @Autowired Memberships memberships;
  @Autowired RoomDirectory directory;
  @Autowired SessionAuthority sessions;

  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
  jumpking.service.CrownService crowns;

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
  void delayedCrownReadsDoNotBlockExistingRoomsOrJoinAClosedConnection() throws Exception {
    var release = new CountDownLatch(1);
    var entered = new CountDownLatch(1);
    var joining = new java.util.ArrayList<GameClient>();
    try (var host = new GameClient(port);
        var friend = new GameClient(port);
        var requests = Executors.newFixedThreadPool(4)) {
      try {
        host.register();
        friend.register();
        start(host, friend);
        for (int index = 0; index < 4; index++) {
          var client = new GameClient(port);
          joining.add(client);
          client.register();
          client.connect();
        }
        var owners =
            joining.stream()
                .map(client -> client.owner)
                .collect(java.util.stream.Collectors.toSet());
        doAnswer(
                invocation -> {
                  if (owners.contains(invocation.<Long>getArgument(0))) {
                    entered.countDown();
                    if (!release.await(20, TimeUnit.SECONDS))
                      throw new IllegalStateException("Crown read fixture timeout");
                  }
                  return invocation.callRealMethod();
                })
            .when(crowns)
            .crown(anyLong());
        var replies = new java.util.ArrayList<Future<JsonNode>>();
        for (var client : joining)
          replies.add(requests.submit(() -> client.command("CREATE_ROOM", Map.of())));
        assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
        GameClient.until(
            () -> joining.stream().allMatch(client -> memberships.find(client.owner) != null));
        var closed = joining.getLast();
        closed.disconnect();
        long before = host.snapshot().path("serverTick").asLong();
        assertThat(host.ok("HEARTBEAT", Map.of("nonce", "database-pending")).path("nonce").asText())
            .isEqualTo("database-pending");
        time.advance(100);
        host.await(
            message ->
                message.path("type").asText().equals("GAME_SNAPSHOT")
                    && message.path("payload").path("serverTick").asLong() > before);
        release.countDown();
        for (int index = 0; index < joining.size() - 1; index++) {
          assertThat(replies.get(index).get(8, TimeUnit.SECONDS).path("type").asText())
              .isEqualTo("ROOM_JOINED");
          joining.get(index).ok("LEAVE_ROOM", Map.of());
        }
        GameClient.until(() -> memberships.find(closed.owner) == null);
        end(host);
        host.ok("LEAVE_ROOM", Map.of());
        friend.ok("LEAVE_ROOM", Map.of());
      } finally {
        release.countDown();
        joining.forEach(GameClient::close);
      }
    }
  }

  @Test
  void closingTheLastPendingJoinFinalizesAnAbandonedMatchAndReleasesItsSlot() throws Exception {
    var release = new CountDownLatch(1);
    var entered = new CountDownLatch(1);
    try (var host = new GameClient(port);
        var pending = new GameClient(port);
        var request = Executors.newSingleThreadExecutor()) {
      try {
        host.register();
        pending.register();
        host.connect();
        pending.connect();
        String roomId = host.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
        doAnswer(
                invocation -> {
                  entered.countDown();
                  if (!release.await(20, TimeUnit.SECONDS))
                    throw new IllegalStateException("Pending Join fixture timeout");
                  return invocation.callRealMethod();
                })
            .when(crowns)
            .crown(pending.owner);
        request.submit(() -> pending.command("JOIN_ROOM", Map.of("roomId", roomId)));
        assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
        assertThat(memberships.find(pending.owner)).isNotNull();
        assertThat(pending.command("LEAVE_ROOM", Map.of()).path("payload").path("code").asText())
            .isEqualTo("CONFLICT");
        assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(1);
        String playId = host.ok("START_GAME", Map.of()).path("currentPlay").path("id").asText();
        GameClient.until(
            () -> {
              try {
                return host.ok("GET_ROOM_STATE", Map.of())
                        .path("currentPlay")
                        .path("countdownRemainingMs")
                        .asLong()
                    == 3000;
              } catch (Exception error) {
                throw new CompletionException(error);
              }
            });
        time.advance(3000);
        host.await(
            message ->
                message.path("type").asText().equals("GAME_SNAPSHOT")
                    && message.path("payload").path("playId").asText().equals(playId));
        host.ok("LEAVE_ROOM", Map.of());
        pending.disconnect();
        release.countDown();
        var jdbc = TestDatabase.get().jdbc;
        GameClient.until(
            () ->
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM matches WHERE id=? AND end_reason='ALL_DISCONNECTED' AND ended_at IS NOT NULL",
                        Integer.class,
                        playId)
                    == 1);
        GameClient.until(
            () -> memberships.find(pending.owner) == null && directory.find(roomId) == null);
        assertThat(memberships.find(host.owner)).isNull();
        assertThat(
                jdbc.queryForObject(
                    "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, playId))
            .isEqualTo(1);
        assertThat(
                jdbc.queryForObject(
                    "SELECT user_id FROM play_runs WHERE match_id=?", Long.class, playId))
            .isEqualTo(host.owner);
      } finally {
        release.countDown();
      }
    }
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
