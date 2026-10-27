package jumpking.service;

import static org.assertj.core.api.Assertions.*;

import java.math.BigInteger;
import java.util.UUID;
import jumpking.dto.RecordsDto;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;

@org.springframework.boot.test.context.SpringBootTest(classes = jumpking.JumpKingApplication.class)
class RecordsServiceIT {
  @org.springframework.test.context.DynamicPropertySource
  static void database(org.springframework.test.context.DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @org.springframework.beans.factory.annotation.Autowired RecordsService records;

  @Test
  void totalsAllKindsAndKeepsEachAccountHistoryOwnerScoped() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String name = "totals_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12),
        match = UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(username,password_hash,crown,created_at) VALUES (?,'test-hash','NONE',UTC_TIMESTAMP(3))",
        name);
    long owner = jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
    long peer = TestDatabase.get().account();
    try {
      jdbc.update(
          "INSERT INTO matches(id,room_code,mode,map_id,started_at,ended_at,duration_ticks,end_reason) VALUES (?,'ABCDEF','RACE',10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),180,'FINISH')",
          match);
      for (boolean room : java.util.List.of(false, true)) {
        long ticks = room ? 180 : 61;
        jdbc.update(
            "INSERT INTO play_runs(id,user_id,match_id,status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,started_at,ended_at,updated_at) VALUES (?,?,?,'FINISHED',?,2,1,100,100,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            UUID.randomUUID().toString(),
            owner,
            room ? match : null,
            ticks,
            ticks,
            ticks,
            room ? 1 : null);
      }
      jdbc.update(
          "INSERT INTO play_runs(id,user_id,match_id,status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,started_at,ended_at,updated_at) SELECT ?,?,match_id,status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,started_at,ended_at,updated_at FROM play_runs WHERE user_id=? AND match_id IS NOT NULL",
          UUID.randomUUID().toString(),
          peer,
          owner);
      var total = records.statistics(owner);
      assertThat(total.totalPlayTimeMs()).isEqualTo(BigInteger.valueOf(4016));
      assertThat(total.totalJumps()).isEqualTo(4);
      assertThat(total.totalFalls()).isEqualTo(2);
      assertThat(total.finishes()).isEqualTo(1);
      assertThat(total.bestFinishTimeMs()).isEqualTo(1016);
      assertThat(total.matchesPlayed()).isEqualTo(1);
      assertThat(total.roomWins()).isEqualTo(1);
      assertThat(records.statistics(peer).roomWins()).isEqualTo(1);
      assertThat(records.statistics(Long.MAX_VALUE).totalPlayTimeMs()).isEqualTo(BigInteger.ZERO);
      var first = records.history(owner, 0, 1);
      var second = records.history(owner, 1, 1);
      assertThat(first.items()).hasSize(1);
      assertThat(first.hasNext()).isTrue();
      assertThat(second.items()).hasSize(1);
      assertThat(second.hasNext()).isFalse();
      assertThat(
              java.util.stream.Stream.concat(first.items().stream(), second.items().stream())
                  .map(RecordsDto.History::kind))
          .containsExactlyInAnyOrder("COMMUNITY", "ROOM");
      var detail = records.detail(owner, "ROOM", match);
      assertThat(detail.path("room").path("mapId").asInt()).isEqualTo(10);
      assertThat(detail.path("participants").size()).isEqualTo(2);
      assertThat(detail.path("participants").get(0).path("username").asText()).isNotBlank();
      assertThat(detail.has("snapshot")).isFalse();
      assertThatThrownBy(() -> records.detail(Long.MAX_VALUE, "ROOM", match))
          .isInstanceOf(jumpking.exception.ApiException.class);
    } finally {
      jdbc.update("DELETE FROM play_runs WHERE user_id=? OR match_id=?", owner, match);
      jdbc.update("DELETE FROM matches WHERE id=?", match);
      jdbc.update("DELETE FROM users WHERE id IN (?,?)", owner, peer);
    }
  }

  @Test
  void roomWinsCountFinalizedFirstPlacesWithoutDnfOrAbortedMatches() {
    var jdbc = TestDatabase.get().jdbc;
    long owner = TestDatabase.get().account();
    var matches = new java.util.ArrayList<String>();
    record Scenario(String reason, String status, int rank) {}
    try {
      for (var scenario :
          java.util.List.of(
              new Scenario("FINISH", "FINISHED", 1),
              new Scenario("TIME_LIMIT", "UNFINISHED", 1),
              new Scenario("HOST_ENDED", "UNFINISHED", 1),
              new Scenario("ABORTED", "UNFINISHED", 1),
              new Scenario("FINISH", "DNF", 1),
              new Scenario("FINISH", "FINISHED", 2),
              new Scenario(null, "ACTIVE", 1))) {
        String match = UUID.randomUUID().toString();
        matches.add(match);
        var endedAt =
            scenario.reason() == null ? null : java.sql.Timestamp.from(java.time.Instant.now());
        jdbc.update(
            "INSERT INTO matches(id,room_code,mode,map_id,started_at,ended_at,duration_ticks,end_reason) VALUES (?,'001234','RACE',1,UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE,?,60,?)",
            match,
            endedAt,
            scenario.reason());
        jdbc.update(
            "INSERT INTO play_runs(id,user_id,match_id,status,play_ticks,finish_ticks,`rank`,started_at,updated_at,ended_at) VALUES (?,?,?,?,60,?,?,UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE,UTC_TIMESTAMP(3),?)",
            UUID.randomUUID().toString(),
            owner,
            match,
            scenario.status(),
            scenario.status().equals("FINISHED") ? 60L : null,
            scenario.rank(),
            endedAt);
      }
      assertThat(records.statistics(owner).roomWins()).isEqualTo(3);
    } finally {
      jdbc.update("DELETE FROM play_runs WHERE user_id=?", owner);
      for (var match : matches) jdbc.update("DELETE FROM matches WHERE id=?", match);
      jdbc.update("DELETE FROM users WHERE id=?", owner);
    }
  }
}
