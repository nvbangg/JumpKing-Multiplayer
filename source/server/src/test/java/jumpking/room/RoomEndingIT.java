package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
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
      "app.allowed-origins=http://allowed.test,http://ending.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomEndingIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RaceRoom server;
  @Autowired SharedData shared;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  private record Started(String room, String play) {}

  private Started start(String mode, GameClient... clients) throws Exception {
    for (var client : clients) {
      client.register();
      client.connect();
    }
    var settings = new HashMap<String, Object>();
    settings.put("mode", mode);
    settings.put("timeLimitMinutes", mode.equals("TIME_LIMIT") ? 30 : null);
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
  void aFailedFinalCommitCannotPlayEndingAndRetryOrReconnectKeepsTheSameWinner() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String trigger = "ending_" + UUID.randomUUID().toString().replace("-", "");
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      var game = start("RACE", a, b);
      var joined =
          a.await(message -> message.path("type").asText().equals("ROOM_JOINED")).path("payload");
      GameClient.until(
          () ->
              jdbc.queryForObject(
                      "SELECT COUNT(*) FROM matches WHERE id=?", Integer.class, game.play)
                  == 1);
      jdbc.execute(
          "CREATE TRIGGER "
              + trigger
              + " BEFORE UPDATE ON matches FOR EACH ROW BEGIN IF NEW.id='"
              + game.play
              + "' AND NEW.ended_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected ending commit failure'; END IF; END");
      var before = MainBabeRoute.beforeFinish(shared, json);
      arrange(
          game.room,
          match -> {
            match.ticks = before.physics().ticks;
            var player = match.players.values().iterator().next();
            player.game.restore(before);
            player.maximum = player.game.physics().progress();
            player.peak = before.physics().ticks;
          });
      time.advance(50);
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("FAILED"));
      assertThat(
              a.messages.stream()
                  .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED")))
          .isEmpty();
      jdbc.execute("DROP TRIGGER " + trigger);
      a.ok("PLAY_AGAIN", Map.of("matchId", game.play));
      saved(a);
      a.await(message -> message.path("type").asText().equals("PLAYER_FINISHED"));
      assertThat(
              b.messages.stream()
                  .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED")))
          .isEmpty();
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND is_winner=TRUE",
                  Integer.class,
                  game.play))
          .isEqualTo(1);
      a.disconnect();
      a.connect();
      a.ok(
          "RECONNECT",
          Map.of(
              "roomId",
              game.room,
              "playerId",
              joined.path("playerId").asText(),
              "reconnectToken",
              joined.path("reconnectToken").asText()));
      GameClient.until(
          () ->
              a.messages.stream()
                      .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED"))
                      .count()
                  == 2);
      assertThat(
              a.messages.stream()
                  .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED"))
                  .allMatch(
                      message -> message.path("payload").path("playId").asText().equals(game.play)))
          .isTrue();
      a.ok("GET_ROOM_STATE", Map.of());
      assertThat(
              a.messages.stream()
                  .filter(message -> message.path("type").asText().equals("PLAYER_FINISHED"))
                  .count())
          .isEqualTo(2);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    } finally {
      jdbc.execute("DROP TRIGGER IF EXISTS " + trigger);
    }
  }
}
