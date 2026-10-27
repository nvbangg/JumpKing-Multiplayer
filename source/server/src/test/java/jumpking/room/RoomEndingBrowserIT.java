package jumpking.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.game.SharedData;
import jumpking.support.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;

@EnabledIfEnvironmentVariable(named = "E2E_BROWSER_PATH", matches = ".+")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RoomEndingBrowserIT {
  private static final int VITE_PORT = BrowserHarness.freePort();

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add(
        "app.allowed-origins", () -> "http://allowed.test,http://127.0.0.1:" + VITE_PORT);
  }

  @Autowired RoomManager rooms;
  @Autowired Memberships memberships;
  @Autowired SharedData shared;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  @Test
  void roomFinishAndNextGameUseTwoIndependentBrowsersWithoutEnding() throws Exception {
    try (var fixture = new RoomBrowserFixture(port, rooms, memberships, shared)) {
      String state =
          json.writeValueAsString(
              Map.of(
                  "winner",
                  fixture.winner,
                  "peer",
                  fixture.peer,
                  "roomId",
                  fixture.roomId,
                  "playId",
                  fixture.playId));
      BrowserHarness.run(
          port,
          VITE_PORT,
          "room-ending",
          "e2e/room-ending-online.spec.ts",
          Map.of("E2E_ROOM_FINISH", state));
    }
  }
}
