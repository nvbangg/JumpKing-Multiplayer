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
        "INSERT INTO users(username,password_hash,created_at) VALUES (?,'test-hash',UTC_TIMESTAMP(3))",
        name);
    long owner = jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
    long peer = TestDatabase.get().account();
    try {
      jdbc.update(
          "INSERT INTO matches(id,room_code,mode,map_level,started_at,ended_at,duration_ticks,end_reason) VALUES (?,'ABCDEF','RACE',9,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),180,'FINISH')",
          match);
      for (String kind : java.util.List.of("COMMUNITY", "ROOM")) {
        boolean room = kind.equals("ROOM");
        long ticks = room ? 180 : 61;
        jdbc.update(
            "INSERT INTO play_runs(id,user_id,kind,match_id,nickname,status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,is_winner,started_at,ended_at,updated_at) VALUES (?,?,?,?,?,'FINISHED',?,2,1,100,100,?,?,?, ?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            UUID.randomUUID().toString(),
            owner,
            kind,
            room ? match : null,
            room ? "A player" : null,
            ticks,
            ticks,
            ticks,
            room ? 1 : null,
            room);
      }
      jdbc.update(
          "INSERT INTO play_runs(id,user_id,kind,match_id,nickname,status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,is_winner,started_at,ended_at,updated_at) SELECT ?,?,kind,match_id,'Other player',status,play_ticks,jumps,falls,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,is_winner,started_at,ended_at,updated_at FROM play_runs WHERE user_id=? AND kind='ROOM'",
          UUID.randomUUID().toString(),
          peer,
          owner);
      var total = records.statistics(owner);
      assertThat(total.totalPlayTimeMs()).isEqualTo(BigInteger.valueOf(4016));
      assertThat(total.totalJumps()).isEqualTo(4);
      assertThat(total.totalFalls()).isEqualTo(2);
      assertThat(total.finishes()).isEqualTo(2);
      assertThat(total.bestFinishTimeMs()).isEqualTo(1016);
      assertThat(total.matchesPlayed()).isEqualTo(1);
      assertThat(total.wins()).isEqualTo(1);
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
      assertThat(detail.path("room").path("mapLevel").asInt()).isEqualTo(9);
      assertThat(detail.path("participants").size()).isEqualTo(2);
      assertThat(detail.has("snapshot")).isFalse();
      assertThatThrownBy(() -> records.detail(Long.MAX_VALUE, "ROOM", match))
          .isInstanceOf(jumpking.exception.ApiException.class);
    } finally {
      jdbc.update("DELETE FROM play_runs WHERE user_id=? OR match_id=?", owner, match);
      jdbc.update("DELETE FROM matches WHERE id=?", match);
      jdbc.update("DELETE FROM users WHERE id IN (?,?)", owner, peer);
    }
  }
}
