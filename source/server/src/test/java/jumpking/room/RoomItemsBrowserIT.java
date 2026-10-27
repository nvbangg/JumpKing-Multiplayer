package jumpking.room;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import jumpking.JumpKingApplication;
import jumpking.network.SerialExecutor;
import jumpking.support.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import org.springframework.test.util.ReflectionTestUtils;

@EnabledIfEnvironmentVariable(named = "E2E_BROWSER_PATH", matches = ".+")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RoomItemsBrowserIT {
  static final int VITE_PORT = BrowserHarness.freePort();
  @LocalServerPort int port;
  @Autowired RoomManager rooms;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper json;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add(
        "app.allowed-origins", () -> "http://allowed.test,http://127.0.0.1:" + VITE_PORT);
  }

  @Test
  void desktopAndMobileUseTheRandomlyGrantedItem() throws Exception {
    try (var solo = new GameClient(port)) {
      solo.register();
      solo.connect();
      var joined = solo.ok("CREATE_ROOM", Map.of());
      var roomId = joined.path("roomId").asText();
      var playerId = joined.path("playerId").asText();
      solo.ok("UPDATE_ROOM_SETTINGS", Map.of("itemCooldownMinutes", 1));
      solo.ok("START_GAME", Map.of());
      solo.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      var room = ((Map<?, ?>) ReflectionTestUtils.getField(rooms, "rooms")).get(roomId);
      var actor = (SerialExecutor) ReflectionTestUtils.getField(room, "actor");
      var granted = new CompletableFuture<Void>();
      actor.execute(
          () -> {
            try {
              // Chỉ fixture chọn sẵn đá để kiểm tra Room solo, không thêm endpoint cấp item.
              var match = (RoomMatch) ReflectionTestUtils.getField(room, "match");
              match.items.slots.get(playerId).held = RoomItems.Kind.ROCK;
              granted.complete(null);
            } catch (Throwable failure) {
              granted.completeExceptionally(failure);
            }
          });
      granted.get(5, TimeUnit.SECONDS);
      var fixture =
          Map.of(
              "owner",
              solo.owner,
              "username",
              solo.request("/auth/me", "GET", null).path("account").path("username").asText(),
              "password",
              "A secure server integration password",
              "context",
              Map.of(
                  "roomId",
                  roomId,
                  "playerId",
                  playerId,
                  "reconnectToken",
                  joined.path("reconnectToken").asText()));
      solo.disconnect();
      BrowserHarness.run(
          port,
          VITE_PORT,
          "room-items",
          "e2e/(items|item-notice)-online.spec.ts",
          Map.of("E2E_ITEMS_ONLINE", "true", "E2E_SOLO_ROCK", json.writeValueAsString(fixture)));
    }
  }
}
