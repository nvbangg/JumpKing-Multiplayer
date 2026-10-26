package jumpking.service;

import static org.assertj.core.api.Assertions.*;

import java.time.*;
import java.util.*;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;

@org.springframework.boot.test.context.SpringBootTest(classes = jumpking.JumpKingApplication.class)
class RoomRunsIT {
  @org.springframework.test.context.DynamicPropertySource
  static void database(org.springframework.test.context.DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @org.springframework.beans.factory.annotation.Autowired RoomRuns records;
  @org.springframework.beans.factory.annotation.Autowired RecordsService history;

  @Test
  void shortFinishesCountWinsWithoutGrantingTheFullMapCrownOrBestTime() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    for (int level = 1; level <= 9; level++) {
      var owners = new ArrayList<Long>();
      String match = UUID.randomUUID().toString();
      try {
        for (int i = 0; i < 2; i++) {
          owners.add(TestDatabase.get().account());
        }
        Instant started = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS),
            ended = started.plusSeconds(10);
        var runs =
            List.of(
                new RoomRuns.Run(
                    UUID.randomUUID().toString(),
                    owners.getFirst(),
                    "FINISHED",
                    600,
                    5,
                    0,
                    100,
                    100,
                    600,
                    600L,
                    1,
                    ended),
                new RoomRuns.Run(
                    UUID.randomUUID().toString(),
                    owners.getLast(),
                    "UNFINISHED",
                    600,
                    4,
                    0,
                    50,
                    50,
                    600,
                    null,
                    2,
                    ended));
        var write =
            new RoomRuns.Write(
                match, "ABCDEF", "RACE", null, level, 3, 1, started, ended, 600, "FINISH", runs,
                Set.of());
        records.save(write);
        records.save(write);
        assertThat(
                jdbc.queryForObject("SELECT map_id FROM matches WHERE id=?", Integer.class, match))
            .isEqualTo(level);
        assertThat(
                history.detail(owners.getFirst(), "ROOM", match).path("room").path("mapId").asInt())
            .isEqualTo(level);
        assertThat(
                jdbc.queryForObject(
                    "SELECT crown FROM users WHERE id=?", String.class, owners.getFirst()))
            .isEqualTo(level == 9 ? "GOLD" : "NONE");
        var stats = history.statistics(owners.getFirst());
        assertThat(stats.finishes()).isEqualTo(1);
        assertThat(stats.totalJumps()).isEqualTo(5);
        assertThat(stats.bestFinishTimeMs()).isEqualTo(level == 9 ? 10000L : null);
        int changedLevel = level == 9 ? 1 : 9;
        assertThatThrownBy(
                () ->
                    records.save(
                        new RoomRuns.Write(
                            match,
                            "ABCDEF",
                            "RACE",
                            null,
                            changedLevel,
                            3,
                            2,
                            started,
                            ended,
                            600,
                            "FINISH",
                            runs,
                            Set.of())))
            .isInstanceOf(jumpking.exception.ApiException.class);
      } finally {
        jdbc.update("DELETE FROM play_runs WHERE match_id=?", match);
        jdbc.update("DELETE FROM matches WHERE id=?", match);
        for (long owner : owners) jdbc.update("DELETE FROM users WHERE id=?", owner);
      }
    }
  }

  @Test
  void wholeRosterCommitsAtomicallyAndStaleWritesDoNotOverwriteFinalResults() throws Exception {
    var db = TestDatabase.get();
    var jdbc = db.jdbc;
    var users = new ArrayList<Long>();
    String match = UUID.randomUUID().toString(),
        a = UUID.randomUUID().toString(),
        b = UUID.randomUUID().toString();
    String trigger = "room_rollback_" + UUID.randomUUID().toString().replace("-", "");
    try {
      for (int index = 0; index < 2; index++) {
        users.add(TestDatabase.get().account());
      }
      String name = "writer_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
      jdbc.update(
          "INSERT INTO users(username,password_hash,created_at) VALUES (?,'test-hash',UTC_TIMESTAMP(3))",
          name);
      users.add(jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name));
      Instant started = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS),
          ended = started.plusSeconds(2);
      var first = new RoomRuns.Run(a, users.get(0), "ACTIVE", 0, 0, 0, 0, 0, 0, null, null, null);
      var second = new RoomRuns.Run(b, users.get(1), "ACTIVE", 0, 0, 0, 0, 0, 0, null, null, null);
      var start =
          new RoomRuns.Write(
              match,
              "ABCDEF",
              "RACE",
              null,
              9,
              3,
              1,
              started,
              null,
              0,
              null,
              List.of(first, second),
              Set.of());
      records.save(start);
      records.save(start);
      var update =
          new RoomRuns.Write(
              match,
              "ABCDEF",
              "RACE",
              null,
              9,
              3,
              2,
              started,
              null,
              60,
              null,
              List.of(
                  new RoomRuns.Run(
                      a, users.get(0), "ACTIVE", 60, 1, 0, 100, 100, 40, null, null, null),
                  new RoomRuns.Run(
                      b, users.get(1), "ACTIVE", 60, 1, 0, 90, 120, 40, null, null, null)),
              Set.of());
      records.save(update);
      records.save(start);
      var finish =
          new RoomRuns.Write(
              match,
              "ABCDEF",
              "RACE",
              null,
              9,
              3,
              3,
              started,
              ended,
              61,
              "FINISH",
              List.of(
                  new RoomRuns.Run(
                      a, users.get(0), "FINISHED", 61, 2, 0, 200, 200, 61, 61L, 1, ended),
                  new RoomRuns.Run(
                      b, users.get(1), "UNFINISHED", 61, 1, 0, 100, 120, 40, null, 2, ended)),
              Set.of(users.getFirst()));
      jdbc.execute(
          "CREATE TRIGGER "
              + trigger
              + " BEFORE UPDATE ON play_runs FOR EACH ROW BEGIN IF NEW.id='"
              + b
              + "' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected room rollback'; END IF; END");
      try {
        assertThatThrownBy(() -> records.save(finish))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
      } finally {
        jdbc.execute("DROP TRIGGER " + trigger);
      }
      assertThat(
              jdbc.queryForObject(
                  "SELECT duration_ticks FROM matches WHERE id=?", Long.class, match))
          .isEqualTo(60);
      assertThat(
              jdbc.queryForObject(
                  "SELECT ended_at FROM matches WHERE id=?", java.sql.Timestamp.class, match))
          .isNull();
      assertThat(jdbc.queryForObject("SELECT jumps FROM play_runs WHERE id=?", Integer.class, a))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject("SELECT crown FROM users WHERE id=?", String.class, users.get(0)))
          .isEqualTo("NONE");
      records.save(finish);
      records.save(finish);
      records.save(update);
      assertThat(
              jdbc.queryForObject("SELECT crown FROM users WHERE id=?", String.class, users.get(0)))
          .isEqualTo("BLACK");
      assertThat(
              jdbc.queryForObject("SELECT crown FROM users WHERE id=?", String.class, users.get(1)))
          .isEqualTo("NONE");
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, match))
          .isEqualTo(2);
      assertThat(jdbc.queryForObject("SELECT user_id FROM play_runs WHERE id=?", Long.class, a))
          .isEqualTo(users.get(0));
      assertThat(jdbc.queryForObject("SELECT jumps FROM play_runs WHERE id=?", Integer.class, a))
          .isEqualTo(2);
      assertThat(history.detail(users.get(0), "ROOM", match).path("participants").size())
          .isEqualTo(2);
      assertThatThrownBy(
              () ->
                  records.save(
                      new RoomRuns.Write(
                          match,
                          "ABCDEF",
                          "RACE",
                          null,
                          9,
                          3,
                          4,
                          started,
                          null,
                          62,
                          null,
                          update.runs(),
                          Set.of())))
          .isInstanceOf(jumpking.exception.ApiException.class);
    } finally {
      jdbc.execute("DROP TRIGGER IF EXISTS " + trigger);
      jdbc.update("DELETE FROM play_runs WHERE match_id=?", match);
      jdbc.update("DELETE FROM matches WHERE id=?", match);
      for (long owner : users) jdbc.update("DELETE FROM users WHERE id=?", owner);
    }
  }
}
