package jumpking.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import jumpking.game.SharedData;
import jumpking.network.SerialExecutor;
import jumpking.support.GameClient;
import jumpking.support.MainBabeRoute;
import org.springframework.test.util.ReflectionTestUtils;

/** State trước Finish Room chỉ được chuẩn bị trong test, không có endpoint cheat. */
public final class RoomBrowserFixture implements AutoCloseable {
  private final GameClient first, second;
  private final Memberships memberships;
  public final Map<String, Object> winner, peer;
  public final String roomId, playId;
  private static final String PASSWORD = "A secure server integration password";

  public RoomBrowserFixture(
      int port, RoomManager server, Memberships memberships, SharedData shared, ObjectMapper json)
      throws Exception {
    this.memberships = memberships;
    first = new GameClient(port);
    second = new GameClient(port);
    try {
      first.register();
      second.register();
      first.connect();
      second.connect();
      var host = first.ok("CREATE_ROOM", Map.of());
      roomId = host.path("roomId").asText();
      first.ok("UPDATE_ROOM_SETTINGS", Map.of("mapId", RoomSettings.FINAL_MAP_ID));
      var other = second.ok("JOIN_ROOM", Map.of("roomId", roomId));
      first.ok("START_GAME", Map.of());
      playId =
          first
              .await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload")
              .path("playId")
              .asText();
      first.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      first.disconnect();
      second.disconnect();
      var before = MainBabeRoute.beforeFinish(shared, json);
      Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(roomId);
      var actor = (SerialExecutor) ReflectionTestUtils.getField(room, "actor");
      GameClient.until(
          () -> {
            var offline = new CompletableFuture<Boolean>();
            actor.execute(
                () ->
                    offline.complete(
                        ((Map<?, ?>) ReflectionTestUtils.getField(room, "players"))
                            .values().stream()
                                .allMatch(
                                    player ->
                                        ReflectionTestUtils.getField(player, "connection")
                                            == null)));
            return offline.join();
          });
      var prepared = new CompletableFuture<Void>();
      ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
          .execute(
              () -> {
                try {
                  var match = (RoomMatch) ReflectionTestUtils.getField(room, "match");
                  match.ticks = before.physics().ticks;
                  var player = match.players.get(host.path("playerId").asText());
                  player.game.restore(before);
                  player.maximum = player.game.physics().progress();
                  player.peak = before.physics().ticks;
                  prepared.complete(null);
                } catch (Throwable error) {
                  prepared.completeExceptionally(error);
                }
              });
      prepared.get(8, TimeUnit.SECONDS);
      winner = credentials(first, host);
      peer = credentials(second, other);
      first.disconnect();
      second.disconnect();
    } catch (Exception | Error failure) {
      first.close();
      second.close();
      throw failure;
    }
  }

  private Map<String, Object> credentials(
      GameClient client, com.fasterxml.jackson.databind.JsonNode joined) throws Exception {
    return Map.of(
        "owner",
        client.owner,
        "username",
        client.request("/auth/me", "GET", null).path("account").path("username").asText(),
        "password",
        PASSWORD,
        "context",
        Map.of(
            "roomId",
            roomId,
            "playerId",
            joined.path("playerId").asText(),
            "reconnectToken",
            joined.path("reconnectToken").asText()));
  }

  @Override
  public void close() throws Exception {
    try {
      for (var entry : List.of(Map.entry(first, winner), Map.entry(second, peer))) {
        var client = entry.getKey();
        var credential = entry.getValue();
        if (memberships.find(client.owner) == null) continue;
        client.login((String) credential.get("username"), PASSWORD);
        client.connect();
        @SuppressWarnings("unchecked")
        var context = (Map<String, Object>) credential.get("context");
        client.ok("RECONNECT", context);
        client.ok("LEAVE_ROOM", Map.of());
      }
    } finally {
      first.close();
      second.close();
    }
  }
}
