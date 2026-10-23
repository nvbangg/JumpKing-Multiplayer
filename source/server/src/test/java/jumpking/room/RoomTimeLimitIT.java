package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.concurrent.*;
import java.util.function.Consumer;
import jumpking.JumpKingApplication;
import jumpking.game.SharedData;
import jumpking.network.SerialExecutor;
import jumpking.support.GameClient;
import jumpking.support.MainBabeRoute;
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
      "app.allowed-origins=http://allowed.test,http://time-limit.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomTimeLimitIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RoomManager server;
  @Autowired SharedData shared;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  private record Started(String room, String play) {}

  private Started start(GameClient a, GameClient b, int minutes) throws Exception {
    a.register();
    b.register();
    a.connect();
    b.connect();
    String room =
        a.ok(
                "CREATE_ROOM",
                Map.of(
                    "settings",
                    Map.of(
                        "mode",
                        "TIME_LIMIT",
                        "timeLimitMinutes",
                        minutes,
                        "mapLevel",
                        RoomSettings.FULL_MAP_LEVEL)))
            .path("roomId")
            .asText();
    b.ok("JOIN_ROOM", Map.of("roomId", room));
    a.ok("START_GAME", Map.of());
    String play =
        a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
            .path("payload")
            .path("playId")
            .asText();
    time.advance(3000);
    a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
    return new Started(room, play);
  }

  private void arrange(String id, Consumer<RoomMatch> operation) throws Exception {
    Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(id);
    var result = new CompletableFuture<Void>();
    ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
        .execute(
            () -> {
              try {
                operation.accept((RoomMatch) ReflectionTestUtils.getField(room, "match"));
                result.complete(null);
              } catch (Throwable error) {
                result.completeExceptionally(error);
              }
            });
    result.get(8, TimeUnit.SECONDS);
  }

  @Test
  void timeoutStopsAtTheExactTickAndProducesNoWinnerWithoutFinish() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      var game = start(a, b, 1);
      assertThat(a.snapshot().path("remainingTimeMs").asLong()).isBetween(59_900L, 60_000L);
      arrange(
          game.room,
          match -> {
            match.ticks = 3598;
            for (var player : match.players.values()) {
              var saved = player.game.snapshot();
              saved.physics().ticks = 3598;
              ((ObjectNode) saved.world()).put("lastTick", 3598);
              player.game.restore(saved);
            }
          });
      time.advance(50);
      var ended =
          a.await(message -> message.path("type").asText().equals("GAME_FINISHED")).path("payload");
      assertThat(ended.path("reason").asText()).isEqualTo("TIME_LIMIT");
      assertThat(ended.path("durationMs").asLong()).isEqualTo(60_000);
      for (var row : ended.path("results")) {
        assertThat(row.path("isWinner").asBoolean()).isFalse();
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
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT duration_ticks FROM matches WHERE id=?", Long.class, game.play))
          .isEqualTo(3600);
      time.advance(5000);
      Thread.sleep(50);
      assertThat(
              a.ok("GET_ROOM_STATE", Map.of()).path("currentPlay").path("elapsedTimeMs").asLong())
          .isEqualTo(60_000);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void nativeFinishOnTheDeadlineIsProcessedBeforeTimeoutForTheEntireTick() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      var game = start(a, b, 5);
      var before = MainBabeRoute.beforeFinish(shared, json);
      before.physics().ticks = 17_999;
      ((ObjectNode) before.world()).put("lastTick", 17_999);
      arrange(
          game.room,
          match -> {
            match.ticks = 17_999;
            for (var player : match.players.values()) {
              player.game.restore(before);
              player.maximum = player.game.physics().progress();
              player.peak = 17_999;
            }
          });
      time.advance(50);
      var ended =
          a.await(message -> message.path("type").asText().equals("GAME_FINISHED")).path("payload");
      assertThat(ended.path("reason").asText()).isEqualTo("FINISH");
      assertThat(ended.path("durationMs").asLong()).isEqualTo(300_000);
      for (var row : ended.path("results")) {
        assertThat(row.path("isWinner").asBoolean()).isTrue();
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
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='FINISHED' AND finish_ticks=18000 AND is_winner=TRUE",
                      Integer.class,
                      game.play))
          .isEqualTo(2);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }
}
