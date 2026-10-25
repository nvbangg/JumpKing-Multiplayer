package jumpking.room;

import static org.assertj.core.api.Assertions.*;

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
    properties = "app.allowed-origins=http://allowed.test,http://tick-recovery.test")
class TickRecoveryIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @LocalServerPort int port;

  private void assertCatchUp(GameClient client) throws Exception {
    var snapshot = client.snapshot();
    long before = snapshot.path("self").path("simulation").path("physics").path("ticks").asLong();
    for (int seq = 1; seq <= 9; seq++)
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
              false));
    client.ok("GET_ROOM_STATE", Map.of());
    assertThat(client.snapshot().path("self").path("lastProcessedInputSeq").asLong()).isLessThan(9);

    // Nợ mười hai tick đủ phát snapshot ACK cuối dù vị trí ban đầu lệch nhịp snapshot 20 Hz.
    // Giữ clock đứng yên: phần vượt năm tick phải được xử lý ở các lượt kế tiếp.
    time.advance(200);
    var caughtUp =
        client
            .await(
                message ->
                    message.path("type").asText().equals("GAME_SNAPSHOT")
                        && message
                                .path("payload")
                                .path("self")
                                .path("lastProcessedInputSeq")
                                .asLong()
                            == 9)
            .path("payload");
    assertThat(caughtUp.path("self").path("simulation").path("physics").path("ticks").asLong())
        .isGreaterThanOrEqualTo(before + 9);
  }

  @Test
  void roomRetainsClockDebtAndAcknowledgesOnlyInputsActuallyConsumed() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      client.ok("CREATE_ROOM", Map.of());
      client.ok("START_GAME", Map.of());
      var started =
          client
              .await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload");
      client.ok(
          "GAME_READY",
          Map.of(
              "playId", started.path("playId").asText(),
              "generation", started.path("generation").asLong()));
      time.advance(3000);
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      assertCatchUp(client);
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void communityRetainsClockDebtAndAcknowledgesOnlyInputsActuallyConsumed() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      assertCatchUp(client);
      client.ok("LEAVE_ROOM", Map.of());
    }
  }
}
