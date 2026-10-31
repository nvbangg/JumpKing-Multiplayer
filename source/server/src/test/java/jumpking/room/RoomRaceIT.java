package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "app.checkpoint-interval-ms=25"})
class RoomRaceIT {
  static class TestTime extends MonotonicTime {
    private final AtomicLong value = new AtomicLong(1_000_000_000L);

    @Override
    public long nanos() {
      return value.get();
    }

    void advance(long milliseconds) {
      value.addAndGet(TimeUnit.MILLISECONDS.toNanos(milliseconds));
    }
  }

  @TestConfiguration
  static class TimeConfiguration {
    @Bean
    @Primary
    TestTime testTime() {
      return new TestTime();
    }
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired TestTime time;
  @Autowired RoomManager server;
  @Autowired jumpking.game.SharedData shared;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper json;
  @LocalServerPort int port;

  private void step(GameClient client, long milliseconds) throws Exception {
    long previous =
        client.ok("GET_ROOM_STATE", Map.of()).path("currentPlay").path("elapsedTimeMs").asLong();
    time.advance(milliseconds);
    client.await(
        message ->
            message.path("type").asText().equals("GAME_SNAPSHOT")
                && message.path("payload").path("elapsedTimeMs").asLong() > previous);
  }

  @Test
  void hostRendererStartsOneCountdownWithoutWaitingForPeersAndAcceptsLateReadiness()
      throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.autoReady = b.autoReady = false;
      for (var client : List.of(a, b)) {
        client.register();
        client.connect();
      }
      String room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", room));
      a.ok("START_GAME", Map.of());
      assertThat(a.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("CONFLICT");
      assertThat(b.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("FORBIDDEN");
      var started = a.await(m -> m.path("type").asText().equals("GAME_STARTED")).path("payload");
      String play = started.path("playId").asText();
      var ready = Map.of("playId", play, "generation", 1);
      time.advance(5000);
      var loading = a.ok("GET_ROOM_STATE", Map.of());
      assertThat(loading.path("state").asText()).isEqualTo("COUNTDOWN");
      assertThat(loading.path("currentPlay").path("elapsedTimeMs").asLong()).isZero();
      assertThat(loading.path("currentPlay").path("countdownRemainingMs").asLong()).isZero();
      assertThat(a.messages.stream().anyMatch(m -> m.path("type").asText().equals("GAME_SNAPSHOT")))
          .isFalse();
      assertThat(
              b.command("GAME_READY", Map.of("playId", play, "generation", 99))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("STALE_PLAY");
      var countdown = a.ok("GAME_READY", ready);
      assertThat(countdown.path("currentPlay").path("countdownRemainingMs").asLong())
          .isEqualTo(3000);
      time.advance(1000);
      a.ok("GAME_READY", ready);
      assertThat(
              a.ok("GET_ROOM_STATE", Map.of())
                  .path("currentPlay")
                  .path("countdownRemainingMs")
                  .asLong())
          .isEqualTo(2000);
      time.advance(1000);
      assertThat(
              b.ok("GET_ROOM_STATE", Map.of())
                  .path("currentPlay")
                  .path("countdownRemainingMs")
                  .asLong())
          .isEqualTo(1000);
      time.advance(1000);
      a.await(m -> m.path("type").asText().equals("GAME_SNAPSHOT"));
      var peerSnapshot = b.await(m -> m.path("type").asText().equals("GAME_SNAPSHOT"));
      assertThat(peerSnapshot.path("payload").path("playId").asText()).isEqualTo(play);
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("state").asText()).isEqualTo("PLAYING");
      var lateReady = b.ok("GAME_READY", ready);
      assertThat(lateReady.path("state").asText()).isEqualTo("PLAYING");
      assertThat(lateReady.path("currentPlay").path("id").asText()).isEqualTo(play);
      assertThat(lateReady.path("currentPlay").path("countdownRemainingMs").asLong()).isZero();
      assertThat(a.ok("GAME_READY", ready).path("state").asText()).isEqualTo("PLAYING");
      for (var invalid :
          List.of(
              Map.of("playId", "old-match", "generation", 1),
              Map.of("playId", play, "generation", 99)))
        assertThat(b.command("GAME_READY", invalid).path("payload").path("code").asText())
            .isEqualTo("STALE_PLAY");
      a.socket
          .sendText(
              json.writeValueAsString(
                  Map.of("v", 1, "type", "SET_ROOM_PAUSED", "payload", Map.of("paused", true))),
              true)
          .join();
      a.await(
          m ->
              m.path("type").asText().equals("ERROR")
                  && m.path("payload").path("code").asText().equals("INVALID_MESSAGE"));
      step(a, 100);
      a.ok("END_MATCH", Map.of());
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void hostRendererTimeoutReturnsToLobbyEvenWhenAPeerIsReadyWithoutWritingAMatch()
      throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.autoReady = b.autoReady = false;
      for (var client : List.of(a, b)) {
        client.register();
        client.connect();
      }
      String room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", room));
      a.ok("START_GAME", Map.of());
      var started = a.await(m -> m.path("type").asText().equals("GAME_STARTED")).path("payload");
      b.ok("GAME_READY", Map.of("playId", started.path("playId").asText(), "generation", 1));
      a.messages.clear();
      time.advance(shared.rules().path("roomLoadTimeoutMs").asLong());
      a.await(
          m ->
              m.path("type").asText().equals("ROOM_STATE")
                  && m.path("payload").path("state").asText().equals("WAITING")
                  && m.path("payload").path("currentPlay").isNull());
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM matches WHERE room_code=?", Integer.class, room))
          .isZero();
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void staleInputDisconnectsOnlyTheAffectedPlayerAndReconnectCancelsCharge() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      var join = a.ok("CREATE_ROOM", Map.of());
      String id = join.path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", id));
      a.ok("START_GAME", Map.of());
      time.advance(3000);
      String play =
          a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"))
              .path("payload")
              .path("playId")
              .asText();
      for (int seq = 1; seq <= 40; seq++)
        a.input(
            Map.of(
                "playId",
                play,
                "generation",
                1,
                "seq",
                seq,
                "left",
                false,
                "right",
                false,
                "jump",
                true));
      a.ok("GET_ROOM_STATE", Map.of());
      step(b, 499);
      a.input(
          Map.of(
              "playId",
              play,
              "generation",
              1,
              "seq",
              41,
              "left",
              false,
              "right",
              false,
              "jump",
              false));
      a.ok("GET_ROOM_STATE", Map.of());
      time.advance(1);
      GameClient.until(a.socket::isInputClosed);
      assertThat(b.ok("GET_ROOM_STATE", Map.of()).path("state").asText()).isEqualTo("PLAYING");
      a.connect();
      var context =
          a.ok(
              "RECONNECT",
              Map.of(
                  "roomId",
                  id,
                  "playerId",
                  join.path("playerId").asText(),
                  "reconnectToken",
                  join.path("reconnectToken").asText()));
      assertThat(context.path("generation").asInt()).isEqualTo(2);
      time.advance(50);
      var state =
          a.await(
                  message ->
                      message.path("type").asText().equals("GAME_SNAPSHOT")
                          && message.path("payload").path("generation").asInt() == 2)
              .path("payload");
      assertThat(state.path("self").path("lastProcessedInputSeq").asLong()).isZero();
      assertThat(state.path("self").path("simulation").path("physics").path("charge").asInt())
          .isZero();
      assertThat(state.path("self").path("simulation").path("physics").path("jumps").asInt())
          .isZero();
      b.ok("END_MATCH", Map.of());
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void distantPlayersRemainRankedWithoutBroadcastingTheirPose() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String id = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      String peer = b.ok("JOIN_ROOM", Map.of("roomId", id)).path("playerId").asText();
      a.ok("START_GAME", Map.of());
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      var room =
          ((Map<?, ?>) org.springframework.test.util.ReflectionTestUtils.getField(server, "rooms"))
              .get(id);
      var actor =
          (jumpking.network.SerialExecutor)
              org.springframework.test.util.ReflectionTestUtils.getField(room, "actor");
      var restored = new java.util.concurrent.CompletableFuture<Void>();
      actor.execute(
          () -> {
            try {
              var match =
                  (RoomMatch)
                      org.springframework.test.util.ReflectionTestUtils.getField(room, "match");
              var game = match.players.get(peer).game;
              var state = game.physics().snapshot();
              state.x = 200;
              state.y = -1000;
              state.screen = 3;
              state.grounded = false;
              game.physics().restore(state);
              restored.complete(null);
            } catch (Throwable error) {
              restored.completeExceptionally(error);
            }
          });
      restored.get(8, TimeUnit.SECONDS);
      time.advance(50);
      var snapshot =
          a.await(
                  message ->
                      message.path("type").asText().equals("GAME_SNAPSHOT")
                          && message.path("payload").path("peers").isEmpty())
              .path("payload");
      assertThat(snapshot.path("players").size()).isEqualTo(2);
      a.ok("END_MATCH", Map.of());
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void permissionsAndCountdownCancellationDoNotCreateHistory() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port);
        var extra = new GameClient(port)) {
      for (var client : List.of(a, b, extra)) {
        client.register();
        client.connect();
      }
      String id = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", id));
      assertThat(b.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("FORBIDDEN");
      assertThat(a.ok("START_GAME", Map.of()).path("state").asText()).isEqualTo("COUNTDOWN");
      assertThat(
              extra
                  .command("JOIN_ROOM", Map.of("roomId", id))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("ROOM_NOT_JOINABLE");
      var settings = new HashMap<String, Object>();
      settings.put("mode", "RACE");
      settings.put("timeLimitMinutes", null);
      assertThat(a.command("UPDATE_ROOM_SETTINGS", settings).path("payload").path("code").asText())
          .isEqualTo("CONFLICT");
      b.ok("LEAVE_ROOM", Map.of());
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("state").asText()).isEqualTo("WAITING");
      time.advance(3000);
      Thread.sleep(50);
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM matches WHERE room_code=?", Integer.class, id))
          .isZero();
      a.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void twoAccountsJumpAndEndTheMatchWithCommittedHistory() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", room));
      a.ok("START_GAME", Map.of());
      String play =
          a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload")
              .path("playId")
              .asText();
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      step(a, 50);
      assertThat(a.ok("GET_ROOM_STATE", Map.of()).path("state").asText()).isEqualTo("PLAYING");
      a.input(
          Map.of(
              "playId",
              play,
              "generation",
              1,
              "seq",
              1,
              "left",
              false,
              "right",
              false,
              "jump",
              true));
      a.ok("GET_ROOM_STATE", Map.of());
      step(a, 100);
      a.input(
          Map.of(
              "playId",
              play,
              "generation",
              1,
              "seq",
              2,
              "left",
              false,
              "right",
              false,
              "jump",
              false));
      a.ok("GET_ROOM_STATE", Map.of());
      step(a, 50);
      assertThat(a.snapshot().path("self").path("simulation").path("physics").path("jumps").asInt())
          .isEqualTo(1);
      GameClient.until(
          () ->
              TestDatabase.get()
                      .jdbc
                      .queryForObject(
                          "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='ACTIVE' AND jumps=1",
                          Integer.class,
                          play)
                  == 1);
      b.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && !message
                      .path("payload")
                      .path("peers")
                      .get(0)
                      .path("state")
                      .path("grounded")
                      .asBoolean()
                  && message
                          .path("payload")
                          .path("peers")
                          .get(0)
                          .path("state")
                          .path("vy")
                          .asDouble()
                      < 0);
      a.messages.clear();
      time.advance(100);
      a.await(
          message ->
              message.path("type").asText().equals("SAVE_STATUS")
                  && message.path("payload").path("saveStatus").asText().equals("SAVED"));
      a.ok("GET_ROOM_STATE", Map.of());
      assertThat(
              a.messages.stream()
                  .filter(message -> message.path("type").asText().equals("ROOM_STATE")))
          .allMatch(message -> message.has("requestId"));
      assertThat(b.command("END_MATCH", Map.of()).path("payload").path("code").asText())
          .isEqualTo("FORBIDDEN");
      var result = a.ok("END_MATCH", Map.of());
      assertThat(result.path("reason").asText()).isEqualTo("HOST_ENDED");
      assertThat(result.path("results").size()).isEqualTo(2);
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("state").asText().equals("FINISHED")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("SAVED"));
      assertThat(a.request("/history", "GET", null).path("items").get(0).path("id").asText())
          .isEqualTo(play);
      assertThat(b.request("/history/ROOM/" + play, "GET", null).path("participants").size())
          .isEqualTo(2);
      var total = a.request("/profile/me", "GET", null).path("total");
      assertThat(total.path("totalJumps").asInt()).isEqualTo(1);
      assertThat(total.path("matchesPlayed").asInt()).isEqualTo(1);
      assertThat(total.has("wins")).isFalse();
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, play))
          .isEqualTo(2);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void nativeRouteCheckpointFinishesBothPlayersInOneServerTickAndFinalizesOnce() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String id = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      a.ok("UPDATE_ROOM_SETTINGS", Map.of("mapId", RoomSettings.FINAL_MAP_ID));
      b.ok("JOIN_ROOM", Map.of("roomId", id));
      a.ok("START_GAME", Map.of());
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      var before = jumpking.support.MainBabeRoute.beforeRoomFinish(shared, json);
      var room =
          ((Map<?, ?>) org.springframework.test.util.ReflectionTestUtils.getField(server, "rooms"))
              .get(id);
      var actor =
          (jumpking.network.SerialExecutor)
              org.springframework.test.util.ReflectionTestUtils.getField(room, "actor");
      var restored = new java.util.concurrent.CompletableFuture<Void>();
      actor.execute(
          () -> {
            try {
              var match =
                  (RoomMatch)
                      org.springframework.test.util.ReflectionTestUtils.getField(room, "match");
              match.ticks = before.physics().ticks;
              for (var player : match.players.values()) {
                player.game.restore(before);
                player.maximum = player.game.physics().progress();
                player.peak = before.physics().ticks;
              }
              restored.complete(null);
            } catch (Throwable error) {
              restored.completeExceptionally(error);
            }
          });
      restored.get(8, TimeUnit.SECONDS);
      time.advance(50);
      var finished =
          a.await(message -> message.path("type").asText().equals("GAME_FINISHED")).path("payload");
      assertThat(finished.path("reason").asText()).isEqualTo("FINISH");
      long finishTicks = before.physics().ticks + 1;
      assertThat(finished.path("durationMs").asLong())
          .isEqualTo(finishTicks * 1000 / shared.tuning().tickRate);
      for (var row : finished.path("results")) {
        assertThat(row.path("rank").asInt()).isEqualTo(1);
      }
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("SAVED"));
      String play = finished.path("playId").asText();
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='FINISHED' AND `rank`=1 AND finish_ticks=?",
                      Integer.class,
                      play,
                      finishTicks))
          .isEqualTo(2);
      assertThat(a.command("END_MATCH", Map.of()).path("type").asText()).isEqualTo("ERROR");
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject("SELECT COUNT(*) FROM matches WHERE id=?", Integer.class, play))
          .isEqualTo(1);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void publicVisibilityIsHostOnlyAtomicAndStartRechecksConcurrentJoins() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port);
        var extra = new GameClient(port)) {
      for (var client : List.of(host, peer, extra)) {
        client.register();
        client.connect();
      }
      String id = host.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      peer.ok("JOIN_ROOM", Map.of("roomId", id));
      assertThat(host.request("/rooms", "GET", null).path("rooms").findValuesAsText("roomId"))
          .contains(id);
      assertThat(
              peer.command("UPDATE_ROOM_SETTINGS", Map.of("visibility", "PUBLIC"))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("FORBIDDEN");
      assertThat(
              host.command(
                      "UPDATE_ROOM_SETTINGS",
                      Map.of("visibility", "PUBLIC", "mode", "INVALID", "timeLimitMinutes", 1))
                  .path("type")
                  .asText())
          .isEqualTo("ERROR");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("visibility").asText())
          .isEqualTo("PUBLIC");
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("visibility", "PRIVATE"));
      assertThat(host.request("/rooms", "GET", null).path("rooms").findValuesAsText("roomId"))
          .doesNotContain(id);
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("visibility", "PUBLIC"));
      assertThat(host.request("/rooms", "GET", null).path("rooms").findValuesAsText("roomId"))
          .contains(id);
      var listed = host.request("/rooms", "GET", null).path("rooms");
      var entry =
          java.util.stream.StreamSupport.stream(listed.spliterator(), false)
              .filter(row -> row.path("roomId").asText().equals(id))
              .findFirst()
              .orElseThrow();
      assertThat(entry.path("playerCount").asInt()).isEqualTo(2);
      assertThat(entry.path("mode").asText()).isEqualTo("RACE");
      assertThat(entry.path("mapId").asInt()).isEqualTo(1);
      for (String secret : List.of("members", "reconnectToken", "username"))
        assertThat(entry.has(secret)).isFalse();
      try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
        var start = pool.submit(() -> host.ok("START_GAME", Map.of()));
        var join = pool.submit(() -> extra.command("JOIN_ROOM", Map.of("roomId", id)));
        assertThat(start.get().path("state").asText()).isEqualTo("COUNTDOWN");
        var joined = join.get();
        if (joined.path("type").asText().equals("ERROR"))
          assertThat(joined.path("payload").path("code").asText()).isEqualTo("ROOM_NOT_JOINABLE");
        else assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members").size()).isEqualTo(3);
      }
      assertThat(host.request("/rooms", "GET", null).path("rooms").findValuesAsText("roomId"))
          .doesNotContain(id);
      assertThat(
              host.command("UPDATE_ROOM_SETTINGS", Map.of("visibility", "PRIVATE"))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      if (host.ok("GET_ROOM_STATE", Map.of()).path("members").size() == 3)
        extra.ok("LEAVE_ROOM", Map.of());
      host.ok("LEAVE_ROOM", Map.of());
      peer.ok("LEAVE_ROOM", Map.of());
    }
  }
}
