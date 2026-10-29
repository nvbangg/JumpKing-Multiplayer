package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import jumpking.JumpKingApplication;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.allowed-origins=http://allowed.test,http://lobby.test")
class RoomLobbyIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;

  private Map<String, Object> reconnect(com.fasterxml.jackson.databind.JsonNode joined) {
    return Map.of(
        "roomId", joined.path("roomId").asText(),
        "playerId", joined.path("playerId").asText(),
        "reconnectToken", joined.path("reconnectToken").asText());
  }

  private com.fasterxml.jackson.databind.JsonNode member(
      com.fasterxml.jackson.databind.JsonNode state, String playerId) {
    for (var member : state.path("members"))
      if (member.path("playerId").asText().equals(playerId)) return member;
    throw new AssertionError("Room member not found: " + playerId);
  }

  @Test
  void defaultConfirmationCanBeCancelledRestoredAndPreservedAcrossUpdatesAndReconnect()
      throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port)) {
      for (var client : List.of(host, peer)) {
        client.register();
        client.connect();
      }
      var room = host.ok("CREATE_ROOM", Map.of());
      var joined = peer.ok("JOIN_ROOM", Map.of("roomId", room.path("roomId").asText()));
      String playerId = joined.path("playerId").asText();
      for (var member : host.ok("GET_ROOM_STATE", Map.of()).path("members")) {
        assertThat(member.path("nextMatchConfirmed").asBoolean()).isTrue();
        assertThat(member.path("nextMatchJoined").asBoolean()).isTrue();
      }
      peer.ok("SET_ROOM_CONFIRMED", Map.of("confirmed", false));
      assertThat(host.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("CONFLICT");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(2);
      host.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("members").size() == 2
                  && !member(message.path("payload"), playerId)
                      .path("nextMatchConfirmed")
                      .asBoolean());
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("mapId", 2));
      var cancelled = member(host.ok("GET_ROOM_STATE", Map.of()), playerId);
      assertThat(cancelled.path("nextMatchConfirmed").asBoolean()).isFalse();
      assertThat(cancelled.path("nextMatchJoined").asBoolean()).isTrue();
      peer.disconnect();
      host.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("members").size() == 2
                  && !member(message.path("payload"), playerId).path("connected").asBoolean());
      peer.connect();
      assertThat(peer.ok("RECONNECT", reconnect(joined)).path("playerId").asText())
          .isEqualTo(playerId);
      var restored = peer.ok("GET_ROOM_STATE", Map.of());
      assertThat(restored.path("members")).hasSize(2);
      assertThat(member(restored, playerId).path("nextMatchConfirmed").asBoolean()).isFalse();
      assertThat(host.command("START_GAME", Map.of()).path("payload").path("code").asText())
          .isEqualTo("CONFLICT");
      peer.ok("SET_ROOM_CONFIRMED", Map.of("confirmed", true));
      assertThat(
              member(host.ok("GET_ROOM_STATE", Map.of()), playerId)
                  .path("nextMatchConfirmed")
                  .asBoolean())
          .isTrue();
      for (var invalid : List.<Map<String, ?>>of(Map.of(), Map.of("confirmed", "false")))
        assertThat(
                peer.command("SET_ROOM_CONFIRMED", invalid).path("payload").path("code").asText())
            .isEqualTo("INVALID_MESSAGE");
      host.ok("START_GAME", Map.of());
      assertThat(
              peer.command("SET_ROOM_CONFIRMED", Map.of("confirmed", false))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      assertThat(
              host.command("KICK_PLAYER", Map.of("playerId", playerId))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      host.ok("LEAVE_ROOM", Map.of());
      peer.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void onlyHostCanKickAnotherLobbyMemberAndTheRemovedTokenCannotReconnect() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port);
        var target = new GameClient(port)) {
      for (var client : List.of(host, peer, target)) {
        client.register();
        client.connect();
      }
      var room = host.ok("CREATE_ROOM", Map.of());
      String roomId = room.path("roomId").asText();
      peer.ok("JOIN_ROOM", Map.of("roomId", roomId));
      var joined = target.ok("JOIN_ROOM", Map.of("roomId", roomId));
      String playerId = joined.path("playerId").asText();
      assertThat(
              peer.command("KICK_PLAYER", Map.of("playerId", playerId))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("FORBIDDEN");
      assertThat(
              host.command("KICK_PLAYER", Map.of("playerId", room.path("playerId").asText()))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("CONFLICT");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(3);
      var kicked = host.ok("KICK_PLAYER", Map.of("playerId", playerId));
      assertThat(kicked.path("members")).hasSize(2);
      var left = target.await(message -> message.path("type").asText().equals("ROOM_LEFT"));
      assertThat(left.path("payload").path("reason").asText()).isEqualTo("KICKED");
      peer.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("members").size() == 2);
      assertThat(target.ok("GET_ROOM_STATE", Map.of()).path("roomId").isNull()).isTrue();
      assertThat(
              target.command("RECONNECT", reconnect(joined)).path("payload").path("code").asText())
          .isEqualTo("RECONNECT_EXPIRED");
      host.ok("LEAVE_ROOM", Map.of());
      peer.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void hostCanKickAnOfflineMemberBeforeItsReconnectDeadline() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port)) {
      for (var client : List.of(host, peer)) {
        client.register();
        client.connect();
      }
      String roomId = host.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      var joined = peer.ok("JOIN_ROOM", Map.of("roomId", roomId));
      String playerId = joined.path("playerId").asText();
      peer.disconnect();
      host.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("members").size() == 2
                  && !member(message.path("payload"), playerId).path("connected").asBoolean());
      assertThat(host.ok("KICK_PLAYER", Map.of("playerId", playerId)).path("members")).hasSize(1);
      peer.connect();
      assertThat(peer.command("RECONNECT", reconnect(joined)).path("payload").path("code").asText())
          .isEqualTo("RECONNECT_EXPIRED");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(1);
      host.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void accountRoomCapacitySettingsPermissionsAndHostTransferUseRealConnections() throws Exception {
    var clients = new ArrayList<GameClient>();
    try {
      for (int index = 0; index < 11; index++) {
        var client = new GameClient(port);
        clients.add(client);
        if (index == 0)
          client.register(
              "player_" + UUID.randomUUID().toString().replace("-", "").substring(0, 25));
        else client.register();
        client.connect();
      }
      var host = clients.getFirst();
      var joined = host.ok("CREATE_ROOM", Map.of());
      String room = joined.path("roomId").asText();
      assertThat(room).matches("[0-9]{6}");
      assertThat(host.request("/rooms/" + room, "GET", null).path("joinable").asBoolean()).isTrue();
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("timeLimitMinutes", 2));
      var invalid = new HashMap<String, Object>();
      invalid.put("timeLimitMinutes", 11);
      assertThat(host.command("UPDATE_ROOM_SETTINGS", invalid).path("type").asText())
          .isEqualTo("ERROR");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("settings").path("mode").asText())
          .isEqualTo("RACE");
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("mode", "NO_WALK"));
      var independent = host.ok("GET_ROOM_STATE", Map.of()).path("settings");
      assertThat(independent.path("mode").asText()).isEqualTo("NO_WALK");
      assertThat(independent.path("timeLimitMinutes").asInt()).isEqualTo(2);
      host.ok("UPDATE_ROOM_SETTINGS", Map.of("mode", "RACE"));
      for (int index = 1; index < 10; index++)
        clients.get(index).ok("JOIN_ROOM", Map.of("roomId", room));
      var chat = host.ok("CHAT_SEND", Map.of("text", "Room chat"));
      assertThat(chat.path("roomId").asText()).isEqualTo(room);
      assertThat(chat.path("messages").get(0).path("nickname").asText())
          .isEqualTo(
              host.request("/auth/me", "GET", null).path("account").path("username").asText());
      clients
          .get(1)
          .await(
              message ->
                  message.path("type").asText().equals("CHAT_MESSAGE")
                      && message.path("payload").path("roomId").asText().equals(room));
      assertThat(
              clients
                  .get(10)
                  .command("JOIN_ROOM", Map.of("roomId", room))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("ROOM_FULL");
      var roster = host.ok("GET_ROOM_STATE", Map.of()).path("members");
      assertThat(roster.size()).isEqualTo(10);
      var colors = new HashSet<Integer>();
      for (var player : roster) {
        colors.add(player.path("colorSlot").asInt());
        assertThat(player.has("reconnectToken")).isFalse();
      }
      assertThat(colors).hasSize(10);
      assertThat(
              clients
                  .get(1)
                  .command("UPDATE_ROOM_SETTINGS", Map.of("timeLimitMinutes", 3))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("FORBIDDEN");
      assertThat(host.request("/rooms/" + room, "GET", null).path("joinable").asBoolean())
          .isFalse();
      host.ok("LEAVE_ROOM", Map.of());
      var next = clients.get(1).ok("GET_ROOM_STATE", Map.of());
      assertThat(next.path("hostPlayerId").asText())
          .isEqualTo(next.path("members").get(0).path("playerId").asText());
      assertThat(next.path("settings").path("timeLimitMinutes").asInt()).isEqualTo(2);
      clients.get(10).ok("JOIN_ROOM", Map.of("roomId", room));
      assertThat(
              clients
                  .get(10)
                  .ok("GET_ROOM_STATE", Map.of())
                  .path("members")
                  .get(9)
                  .path("colorSlot")
                  .asInt())
          .isZero();
      invalid.put("timeLimitMinutes", null);
      clients.get(1).ok("UPDATE_ROOM_SETTINGS", invalid);
      clients.get(1).ok("START_GAME", Map.of());
      var snapshot =
          clients
              .get(1)
              .await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"))
              .path("payload");
      assertThat(snapshot.path("peers").size()).isEqualTo(9);
      var result = clients.get(1).ok("END_MATCH", Map.of());
      assertThat(result.path("results").size()).isEqualTo(10);
      clients
          .get(1)
          .await(
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
                      "SELECT COUNT(*) FROM play_runs WHERE match_id=?",
                      Integer.class,
                      result.path("playId").asText()))
          .isEqualTo(10);
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
