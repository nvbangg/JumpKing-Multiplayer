package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
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
      "app.allowed-origins=http://allowed.test,http://ranking.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomRankingIT {
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

  private Started start(String mode, GameClient... clients) throws Exception {
    return start(mode, null, clients);
  }

  private Started start(String mode, Integer minutes, GameClient... clients) throws Exception {
    for (var client : clients) {
      client.register();
      client.connect();
    }
    var settings = new HashMap<String, Object>();
    settings.put("mode", mode);
    settings.put("mapLevel", RoomSettings.FINAL_MAP_LEVEL);
    settings.put("timeLimitMinutes", minutes);
    String room =
        clients[0].ok("CREATE_ROOM", Map.of("settings", settings)).path("roomId").asText();
    for (int index = 1; index < clients.length; index++)
      clients[index].ok("JOIN_ROOM", Map.of("roomId", room));
    clients[0].ok("START_GAME", Map.of());
    String play =
        clients[0]
            .await(message -> message.path("type").asText().equals("GAME_STARTED"))
            .path("payload")
            .path("playId")
            .asText();
    time.advance(3000);
    clients[0].await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
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

  private void saved(GameClient client) throws Exception {
    client.await(
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
  void allFourModesFinishTogetherAtTheNativeDestinationAndPersistSharedFirstPlace()
      throws Exception {
    var before = MainBabeRoute.beforeFinish(shared, json);
    for (String mode : List.of("RACE", "EASY", "HARDCORE", "NO_WALK")) {
      try (var a = new GameClient(port);
          var b = new GameClient(port)) {
        var game = start(mode, a, b);
        arrange(
            game.room,
            match -> {
              match.ticks = before.physics().ticks;
              for (var player : match.players.values()) {
                player.game.restore(before);
                player.maximum = player.game.physics().progress();
                player.peak = before.physics().ticks;
              }
            });
        time.advance(50);
        var finished =
            a.await(message -> message.path("type").asText().equals("GAME_FINISHED"))
                .path("payload");
        assertThat(finished.path("reason").asText()).as(mode).isEqualTo("FINISH");
        for (var result : finished.path("results")) {
          assertThat(result.path("rank").asInt()).isEqualTo(1);
          assertThat(result.path("isWinner").asBoolean()).isTrue();
        }
        saved(a);
        for (var client : List.of(a, b)) {
          assertThat(
                  client.messages.stream()
                      .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED")))
              .isEmpty();
          client.ok("GET_ROOM_STATE", Map.of());
          assertThat(
                  client.messages.stream()
                      .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED"))
                      .count())
              .isZero();
        }
        assertThat(
                TestDatabase.get()
                    .jdbc
                    .queryForObject(
                        "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND finish_ticks=16957 AND `rank`=1 AND is_winner=TRUE",
                        Integer.class,
                        game.play))
            .as(mode)
            .isEqualTo(2);
        a.ok("LEAVE_ROOM", Map.of());
        b.ok("LEAVE_ROOM", Map.of());
      }
    }
  }

  @Test
  void optionalTimeLimitUsesPeakAfterCurrentHeightRegardlessOfModeAndKeepsDnfMetricsFrozen()
      throws Exception {
    for (String mode : List.of("RACE", "EASY", "HARDCORE", "NO_WALK")) {
      for (boolean limited : List.of(false, true))
        try (var a = new GameClient(port);
            var b = new GameClient(port);
            var c = new GameClient(port)) {
          var game = start(mode, limited ? 10 : null, a, b, c);
          arrange(
              game.room,
              match -> {
                match.ticks = 100;
                int index = 0;
                for (var player : match.players.values()) {
                  var snapshot = player.game.snapshot();
                  var pose = snapshot.physics();
                  pose.x = 77;
                  pose.y = 158;
                  pose.vx = 0;
                  pose.vy =
                      (float)
                          (shared.physics().path("gravityNumerator").asDouble()
                              / shared.physics().path("gravityDenominator").asDouble());
                  pose.grounded = true;
                  pose.ticks = 100;
                  ((ObjectNode) snapshot.world()).put("lastTick", 100);
                  player.game.restore(snapshot);
                  player.currentProgress = player.game.physics().progress();
                  player.maximum = new int[] {900, 1000, 950}[index++];
                  player.peak = 100;
                }
              });
          c.ok("LEAVE_ROOM", Map.of());
          time.advance(50);
          a.await(
              message ->
                  message.path("type").asText().equals("GAME_SNAPSHOT")
                      && message.path("payload").path("elapsedTimeMs").asLong() > 1666);
          a.ok("END_MATCH", Map.of());
          saved(a);
          assertThat(
                  a.messages.stream()
                      .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED")))
              .isEmpty();
          assertThat(
                  b.messages.stream()
                      .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED")))
              .isEmpty();
          var jdbc = TestDatabase.get().jdbc;
          assertThat(
                  jdbc.queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND is_winner=TRUE",
                      Integer.class,
                      game.play))
              .isZero();
          assertThat(
                  jdbc.queryForObject(
                      "SELECT play_ticks FROM play_runs WHERE match_id=? AND user_id=?",
                      Long.class,
                      game.play,
                      c.owner))
              .isEqualTo(100);
          assertThat(
                  jdbc.queryForObject(
                      "SELECT status FROM play_runs WHERE match_id=? AND user_id=?",
                      String.class,
                      game.play,
                      c.owner))
              .isEqualTo("DNF");
          for (int index = 0; index < 3; index++) {
            long owner = new long[] {a.owner, b.owner, c.owner}[index];
            int expected = limited ? new int[] {3, 1, 2}[index] : 1;
            assertThat(
                    jdbc.queryForObject(
                        "SELECT `rank` FROM play_runs WHERE match_id=? AND user_id=?",
                        Integer.class,
                        game.play,
                        owner))
                .as(mode + " limited=" + limited)
                .isEqualTo(expected);
          }
          a.ok("LEAVE_ROOM", Map.of());
          b.ok("LEAVE_ROOM", Map.of());
        }
    }
  }
}
