package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.ArrayList;
import java.util.Map;
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
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "app.checkpoint-interval-ms=25"})
class RoomChatIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;
  @Autowired RoomRaceIT.TestTime time;
  @Autowired ObjectMapper json;

  @Test
  void joiningWithMaximumUnicodeChatHistoryKeepsBothConnectionsUsable() throws Exception {
    try (var host = new GameClient(port);
        var peer = new GameClient(port)) {
      host.register();
      peer.register();
      host.connect();
      peer.connect();
      String roomId = host.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      var sent = new ArrayList<JsonNode>();
      for (int index = 0; index < 11; index++) {
        time.advance(1000);
        var reply = host.ok("CHAT_SEND", Map.of("text", "😀".repeat(199) + (char) ('A' + index)));
        sent.add(reply.path("messages").get(0));
      }
      peer.ok("JOIN_ROOM", Map.of("roomId", roomId));
      var history = peer.await(message -> message.path("type").asText().equals("CHAT_HISTORY"));
      var messages = history.path("payload").path("messages");
      assertThat(messages.size()).isBetween(1, 10);
      for (int index = 0; index < messages.size(); index++)
        assertThat(messages.get(index)).isEqualTo(sent.get(11 - messages.size() + index));
      assertThat(messages.get(messages.size() - 1).path("text").asText()).endsWith("K");
      assertThat(json.writeValueAsBytes(history).length).isLessThanOrEqualTo(16384);
      if (messages.size() < 10) {
        var overflowing = history.deepCopy();
        ((ArrayNode) overflowing.path("payload").path("messages"))
            .insert(0, sent.get(10 - messages.size()));
        assertThat(json.writeValueAsBytes(overflowing).length).isGreaterThan(16384);
      }
      assertThat(peer.ok("GET_ROOM_STATE", Map.of()).path("state").asText()).isEqualTo("WAITING");
      assertThat(host.ok("GET_ROOM_STATE", Map.of()).path("members")).hasSize(2);
      peer.ok("LEAVE_ROOM", Map.of());
      host.ok("LEAVE_ROOM", Map.of());
    }
  }
}
