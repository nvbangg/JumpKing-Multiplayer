package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.Map;
import java.util.UUID;
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
    properties = {
      "app.allowed-origins=http://allowed.test,http://writer.test",
      "app.checkpoint-interval-ms=25"
    })
class RoomWriterIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RoomDirectory directory;
  @Autowired Memberships memberships;
  @LocalServerPort int port;

  @Test
  void leavingEveryoneCannotDiscardAFailedFinalWriteAndRetriesKeepTheSameResult() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String trigger = "writer_" + UUID.randomUUID().toString().replace("-", "");
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
      b.ok("JOIN_ROOM", Map.of("roomId", room));
      a.ok("START_GAME", Map.of());
      String play =
          a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
              .path("payload")
              .path("playId")
              .asText();
      time.advance(3000);
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      jdbc.execute(
          "CREATE TRIGGER "
              + trigger
              + " BEFORE UPDATE ON matches FOR EACH ROW BEGIN IF NEW.id='"
              + play
              + "' AND NEW.ended_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected final write failure'; END IF; END");
      a.ok("END_MATCH", Map.of());
      a.await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message
                      .path("payload")
                      .path("result")
                      .path("saveStatus")
                      .asText()
                      .equals("FAILED"));
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
      assertThat(memberships.find(a.owner)).isNull();
      assertThat(memberships.find(b.owner)).isNull();
      assertThat(directory.find(room)).isNotNull();
      assertThat(directory.find(room).joinable()).isFalse();
      jdbc.execute("DROP TRIGGER " + trigger);
      time.advance(50);
      GameClient.until(() -> directory.find(room) == null);
      assertThat(
              jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, play))
          .isEqualTo("HOST_ENDED");
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='UNFINISHED'",
                  Integer.class,
                  play))
          .isEqualTo(2);
      assertThat(a.request("/history", "GET", null).path("items").get(0).path("id").asText())
          .isEqualTo(play);
      long revision =
          jdbc.queryForObject(
              "SELECT MAX(revision) FROM play_runs WHERE match_id=?", Long.class, play);
      time.advance(1000);
      Thread.sleep(50);
      assertThat(
              jdbc.queryForObject(
                  "SELECT MAX(revision) FROM play_runs WHERE match_id=?", Long.class, play))
          .isEqualTo(revision);
    } finally {
      jdbc.execute("DROP TRIGGER IF EXISTS " + trigger);
    }
  }
}
