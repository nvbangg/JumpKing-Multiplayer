package jumpking.room;

import java.nio.file.Path;
import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.support.BrowserHarness;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@EnabledIfEnvironmentVariable(named = "E2E_BROWSER_PATH", matches = ".+")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RoomPauseBrowserIT {
  private static final int VITE_PORT = BrowserHarness.freePort();

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add("app.allowed-origins", () -> "http://127.0.0.1:" + VITE_PORT);
  }

  @LocalServerPort int port;

  @Test
  void privateRoomIdJoinAndHostPauseKeepBothBrowsersInTheMatch() throws Exception {
    BrowserHarness.run(
        port,
        VITE_PORT,
        "room-pause",
        "e2e/room-pause-online.spec.ts",
        Map.of(
            "E2E_ROOM_PAUSE",
            "true",
            "E2E_OUTPUT_DIR",
            Path.of(System.getProperty("java.io.tmpdir"), "jumpking-room-pause-" + VITE_PORT)
                .toString()));
  }
}
