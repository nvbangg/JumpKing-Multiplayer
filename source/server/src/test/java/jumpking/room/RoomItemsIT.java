package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import jumpking.JumpKingApplication;
import jumpking.network.SerialExecutor;
import jumpking.support.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import org.springframework.test.util.ReflectionTestUtils;

@SpringBootTest(
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "app.checkpoint-interval-ms=25"})
class RoomItemsIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;
  @Autowired RoomRaceIT.TestTime time;
  @Autowired RoomManager server;
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @Autowired ObjectMapper json;

  private void arrange(String id, Consumer<RoomMatch> operation) throws Exception {
    var room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(id);
    var done = new CompletableFuture<Void>();
    ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
        .execute(
            () -> {
              try {
                operation.accept((RoomMatch) ReflectionTestUtils.getField(room, "match"));
                done.complete(null);
              } catch (Throwable e) {
                done.completeExceptionally(e);
              }
            });
    done.get(8, TimeUnit.SECONDS);
  }

  private JsonNode start(GameClient host) throws Exception {
    var started = host.ok("START_GAME", Map.of());
    String play = started.path("currentPlay").path("id").asText();
    time.advance(3000);
    return host.await(
            m ->
                m.path("type").asText().equals("GAME_SNAPSHOT")
                    && m.path("payload").path("playId").asText().equals(play)
                    && !m.path("payload").path("self").path("paused").asBoolean())
        .path("payload");
  }

  private void input(GameClient client, JsonNode snapshot, int seq, boolean jump) throws Exception {
    client.input(
        Map.of(
            "playId",
            snapshot.path("playId").asText(),
            "generation",
            snapshot.path("generation").asLong(),
            "seq",
            seq,
            "left",
            false,
            "right",
            false,
            "jump",
            jump));
    client.ok("GET_ROOM_STATE", Map.of());
  }

  @Test
  void twoClientsUseBothItemsReconnectAndPersistMatchSettings() throws Exception {
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      for (var c : List.of(a, b)) {
        c.register();
        c.connect();
      }
      var joined = a.ok("CREATE_ROOM", Map.of());
      String room = joined.path("roomId").asText();
      var other = b.ok("JOIN_ROOM", Map.of("roomId", room));
      assertThat(
              a.ok("GET_ROOM_STATE", Map.of()).path("settings").path("itemCooldownMinutes").asInt())
          .isEqualTo(3);
      assertThat(
              b.command("UPDATE_ROOM_SETTINGS", Map.of("itemsEnabled", true))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("FORBIDDEN");
      a.ok("UPDATE_ROOM_SETTINGS", Map.of("itemsEnabled", true, "itemCooldownMinutes", 1));
      a.ok("UPDATE_ROOM_SETTINGS", Map.of("mapLevel", 1));
      var first = start(a);
      time.advance(100);
      a.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("elapsedTimeMs").asLong() > 0);
      String id = joined.path("playerId").asText(), peerId = other.path("playerId").asText();
      arrange(
          room,
          match -> {
            match.items.slots.get(id).held = RoomItems.Kind.BANANA;
            match.items.slots.get(peerId).held = RoomItems.Kind.ROCK;
          });
      var context =
          Map.of(
              "playId",
              first.path("playId").asText(),
              "generation",
              first.path("generation").asLong());
      assertThat(
              a.command("USE_ITEM", Map.of("playId", "old", "generation", 1))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("STALE_PLAY");
      var invalid = new HashMap<String, Object>(context);
      invalid.put("targetPlayerId", peerId);
      assertThat(a.command("USE_ITEM", invalid).path("payload").path("code").asText())
          .isEqualTo("INVALID_MESSAGE");
      assertThat(
              a.command("UPDATE_ROOM_SETTINGS", Map.of("itemsEnabled", false))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      a.ok("SET_SPECTATE", Map.of("playerId", peerId));
      assertThat(a.command("USE_ITEM", context).path("payload").path("code").asText())
          .isEqualTo("ITEM_UNAVAILABLE");
      var stopWatching = new HashMap<String, Object>();
      stopWatching.put("playerId", null);
      a.ok("SET_SPECTATE", stopWatching);
      input(a, first, 1, false);
      time.advance(50);
      a.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("self").path("lastProcessedInputSeq").asLong() >= 1);
      a.ok("USE_ITEM", context);
      time.advance(50);
      a.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("items").path("bananaArmed").asBoolean());
      input(a, first, 2, true);
      time.advance(200);
      a.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload")
                          .path("self")
                          .path("simulation")
                          .path("physics")
                          .path("charge")
                          .asInt()
                      > 0);
      input(a, first, 3, false);
      time.advance(100);
      var used =
          a.await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload").path("items").path("cooldownMs").asLong() > 0)
              .path("payload");
      assertThat(used.path("items").path("held").isNull()).isTrue();
      assertThat(a.command("USE_ITEM", context).path("payload").path("code").asText())
          .isEqualTo("ITEM_COOLDOWN");
      b.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("slipping")
                      .asBoolean());
      arrange(
          room,
          match -> {
            var sim = match.players.get(peerId).game.physics();
            var state = sim.snapshot();
            state.slipping = false;
            sim.restore(state);
          });
      var peerContext = Map.of("playId", first.path("playId").asText(), "generation", 1);
      b.ok("USE_ITEM", peerContext);
      time.advance(50);
      var hit =
          a.await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload")
                              .path("self")
                              .path("simulation")
                              .path("physics")
                              .path("slipping")
                              .asBoolean())
              .path("payload");
      assertThat(hit.path("self").path("simulation").path("physics").path("vy").asDouble())
          .isGreaterThanOrEqualTo(0);
      a.disconnect();
      a.connect();
      a.ok(
          "RECONNECT",
          Map.of(
              "roomId",
              room,
              "playerId",
              id,
              "reconnectToken",
              joined.path("reconnectToken").asText()));
      time.advance(50);
      var restored =
          a.await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload").path("generation").asLong() > 1)
              .path("payload");
      assertThat(restored.path("items").path("held").isNull()).isTrue();
      assertThat(restored.path("items").path("cooldownMs").asLong()).isBetween(1L, 60000L);
      b.ok("END_MATCH", Map.of());
      b.await(
          m ->
              m.path("type").asText().equals("ROOM_STATE")
                  && m.path("payload").path("state").asText().equals("FINISHED")
                  && m.path("payload").path("result").path("saveStatus").asText().equals("SAVED"));
      String match = first.path("playId").asText();
      assertThat(
              jdbc.queryForObject(
                  "SELECT items_enabled FROM matches WHERE id=?", Boolean.class, match))
          .isTrue();
      assertThat(
              b.request("/history/ROOM/" + match, "GET", null)
                  .path("room")
                  .path("itemCooldownMinutes")
                  .asInt())
          .isEqualTo(1);
      b.ok("PLAY_AGAIN", Map.of("matchId", match));
      a.ok("PLAY_AGAIN", Map.of("matchId", match));
      var next = start(b);
      assertThat(next.path("playId").asText()).isNotEqualTo(match);
      assertThat(next.path("items").path("held").isTextual()).isTrue();
      assertThat(next.path("items").path("cooldownMs").asLong()).isZero();
      assertThat(next.path("items").path("bananas")).isEmpty();
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void bootsSurviveReconnectAndAreConsumedByTheNextActualJump() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var joined = client.ok("CREATE_ROOM", Map.of());
      String room = joined.path("roomId").asText(), id = joined.path("playerId").asText();
      client.ok("UPDATE_ROOM_SETTINGS", Map.of("itemsEnabled", true));
      var first = start(client);
      time.advance(100);
      arrange(room, match -> match.items.slots.get(id).held = RoomItems.Kind.BOOTS);
      client.ok("USE_ITEM", Map.of("playId", first.path("playId").asText(), "generation", 1));
      time.advance(50);
      var activated =
          client
              .await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload")
                              .path("self")
                              .path("simulation")
                              .path("physics")
                              .path("jumpBoost")
                              .asBoolean())
              .path("payload");
      assertThat(activated.path("items").path("held").isNull()).isTrue();
      assertThat(activated.path("items").path("cooldownMs").asLong()).isGreaterThan(0);
      client.disconnect();
      client.connect();
      client.ok(
          "RECONNECT",
          Map.of(
              "roomId",
              room,
              "playerId",
              id,
              "reconnectToken",
              joined.path("reconnectToken").asText()));
      time.advance(50);
      var restored =
          client
              .await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload").path("generation").asLong() > 1)
              .path("payload");
      assertThat(
              restored
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("jumpBoost")
                  .asBoolean())
          .isTrue();
      input(client, restored, 1, false);
      time.advance(50);
      input(client, restored, 2, true);
      time.advance(200);
      input(client, restored, 3, false);
      time.advance(50);
      var jumped =
          client
              .await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload")
                                  .path("self")
                                  .path("simulation")
                                  .path("physics")
                                  .path("jumps")
                                  .asInt()
                              == 1)
              .path("payload");
      assertThat(jumped.path("self").path("simulation").path("physics").has("jumpBoost")).isFalse();
      assertThat(jumped.path("items").path("cooldownMs").asLong()).isGreaterThan(0);
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void fullRosterAndMaximumBananasFitOneSnapshotWithoutClosingAnyConnection() throws Exception {
    var clients = new ArrayList<GameClient>();
    try {
      for (int index = 0; index < 10; index++) {
        var client = new GameClient(port);
        clients.add(client);
        client.register("𠀀".repeat(31) + index);
        client.connect();
      }
      var host = clients.getFirst();
      var joined = host.ok("CREATE_ROOM", Map.of());
      String roomId = joined.path("roomId").asText();
      String playerId = joined.path("playerId").asText();
      for (int index = 1; index < clients.size(); index++)
        clients.get(index).ok("JOIN_ROOM", Map.of("roomId", roomId));
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("itemsEnabled", true));
      start(host);
      arrange(
          roomId,
          match -> {
            var simulation = match.players.get(playerId).game.physics();
            var original = simulation.snapshot();
            for (int index = 0; index < 64; index++) {
              var pose = simulation.snapshot();
              pose.x = (float) (20.12345 + index % 16 * 24);
              pose.y = (float) (280.12345 - index / 16 * 40);
              pose.grounded = true;
              pose.vy = pose.charge = 0;
              simulation.restore(pose);
              match.items.slots.get(playerId).held = RoomItems.Kind.BANANA;
              match.items.use(playerId, simulation, Map.of(), match.ticks, 3);
              match.items.takeoff(playerId, simulation, match.ticks, 3);
            }
            simulation.restore(original);
          });
      time.advance(100);
      for (var client : clients) {
        var snapshot =
            client.await(
                message ->
                    message.path("type").asText().equals("GAME_SNAPSHOT")
                        && message.path("payload").path("items").path("bananas").size() == 64);
        assertThat(snapshot.path("payload").path("players")).hasSize(10);
        assertThat(snapshot.path("payload").path("peers")).hasSize(9);
        assertThat(json.writeValueAsBytes(snapshot).length).isLessThanOrEqualTo(16384);
        assertThat(client.ok("GET_ROOM_STATE", Map.of()).path("state").asText())
            .isEqualTo("PLAYING");
      }
      String target =
          host.ok("GET_ROOM_STATE", Map.of()).path("members").get(1).path("playerId").asText();
      host.ok("SET_SPECTATE", Map.of("playerId", target));
      time.advance(100);
      var watched =
          host.await(
              message ->
                  message.path("type").asText().equals("GAME_SNAPSHOT")
                      && message.path("payload").path("spectating").isObject());
      assertThat(watched.path("payload").path("items").path("bananas")).hasSize(64);
      assertThat(json.writeValueAsBytes(watched).length).isLessThanOrEqualTo(16384);
      host.ok("END_MATCH", Map.of());
    } finally {
      for (var client : clients) {
        try {
          if (client.socket != null) client.ok("LEAVE_ROOM", Map.of());
        } catch (Exception ignored) {
        }
        client.close();
      }
    }
  }
}
