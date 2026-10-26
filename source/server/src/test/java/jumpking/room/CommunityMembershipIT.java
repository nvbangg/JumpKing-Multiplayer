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
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.allowed-origins=http://allowed.test")
class CommunityMembershipIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;
  @Autowired Memberships memberships;
  @Autowired RoomDirectory directory;

  @Test
  void capacityAndReconnectRejectDirectCommunityJoinAndForeignIdentity() throws Exception {
    var clients = new ArrayList<GameClient>();
    try {
      String full = null;
      com.fasterxml.jackson.databind.JsonNode original = null;
      for (int index = 0; index < 11; index++) {
        var client = new GameClient(port);
        clients.add(client);
        client.register();
        client.connect();
        var joined = client.ok("JOIN_COMMUNITY", client.communityRequest());
        if (index == 0) {
          full = joined.path("roomId").asText();
          original = joined;
        }
        if (index < 10) assertThat(joined.path("roomId").asText()).isEqualTo(full);
      }
      var first = clients.getFirst();
      var last = clients.getLast();
      String target = memberships.find(last.owner).roomId();
      assertThat(target).isNotEqualTo(full);
      assertThat(directory.find(full).joinable()).isFalse();
      var fullState = first.ok("GET_ROOM_STATE", Map.of());
      assertThat(fullState.path("members")).hasSize(10);
      first.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message.path("payload").path("players").size() == 10);
      var standings = first.snapshot().path("players");
      assertThat(standings).hasSize(10);
      var ids = new HashSet<String>();
      for (var row : standings) {
        assertThat(row.path("rank").asInt()).isEqualTo(1);
        ids.add(row.path("playerId").asText());
        assertThat(row.has("owner")).isFalse();
      }
      assertThat(ids).hasSize(10);
      var colors = new HashSet<Integer>();
      fullState.path("members").forEach(member -> colors.add(member.path("colorSlot").asInt()));
      assertThat(colors).hasSize(10);
      assertThat(
              last.command("JOIN_ROOM", Map.of("roomId", full))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("ROOM_NOT_FOUND");
      assertThat(memberships.find(last.owner).roomId()).isEqualTo(target);
      String originalRun = original.path("playId").asText();
      assertThat(first.command("JOIN_ROOM", Map.of("roomId", target)).path("type").asText())
          .isEqualTo("ERROR");
      var moved = original;
      target = full;
      assertThat(first.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(10);
      assertThat(
              last.command(
                      "RECONNECT",
                      Map.of(
                          "roomId",
                          target,
                          "playerId",
                          moved.path("playerId").asText(),
                          "reconnectToken",
                          moved.path("reconnectToken").asText()))
                  .path("type")
                  .asText())
          .isEqualTo("ERROR");
      var oldSocket = first.socket;
      first.connect();
      assertThat(
              first
                  .command(
                      "RECONNECT",
                      Map.of(
                          "roomId",
                          target,
                          "playerId",
                          moved.path("playerId").asText(),
                          "reconnectToken",
                          "x".repeat(43)))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("INVALID_RECONNECT");
      var reconnected =
          first.ok(
              "RECONNECT",
              Map.of(
                  "roomId",
                  target,
                  "playerId",
                  moved.path("playerId").asText(),
                  "reconnectToken",
                  moved.path("reconnectToken").asText()));
      assertThat(reconnected.path("generation").asLong())
          .isGreaterThan(moved.path("generation").asLong());
      oldSocket.abort();
      var state = first.ok("GET_ROOM_STATE", Map.of());
      var self =
          java.util.stream.StreamSupport.stream(state.path("members").spliterator(), false)
              .filter(
                  member ->
                      member.path("playerId").asText().equals(moved.path("playerId").asText()))
              .findFirst()
              .orElseThrow();
      assertThat(self.path("connected").asBoolean()).isTrue();
      assertThat(self.path("paused").asBoolean()).isTrue();
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject(
                      "SELECT COUNT(*) FROM play_runs WHERE user_id=? AND match_id IS NULL AND status='ACTIVE'",
                      Integer.class,
                      first.owner))
          .isEqualTo(1);
      for (var client : clients) client.ok("LEAVE_ROOM", Map.of());
    } finally {
      clients.forEach(GameClient::close);
    }
  }
}
