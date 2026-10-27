package jumpking.service;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import jumpking.dto.RecordsDto;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;

@org.springframework.boot.test.context.SpringBootTest(classes = jumpking.JumpKingApplication.class)
class LeaderboardIT {
  @org.springframework.test.context.DynamicPropertySource
  static void database(org.springframework.test.context.DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @org.springframework.beans.factory.annotation.Autowired RecordsService records;

  @Test
  void choosesOneWholeRunPerAccountAndComputesTiesBeforeLimitUsingCommunityOnly() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    var owners = new ArrayList<Long>();
    var ids = new ArrayList<String>();
    String match = UUID.randomUUID().toString();
    try {
      for (int index = 0; index < 4; index++) {
        String name = "ranking_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.update(
            "INSERT INTO users(username,password_hash,crown,created_at) VALUES (?,'unused-test-hash','NONE',UTC_TIMESTAMP(3))",
            name);
        owners.add(jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name));
      }
      for (int index = 0; index < 3; index++) {
        String id = UUID.randomUUID().toString();
        ids.add(id);
        long ticks = index < 2 ? 600 : 1200;
        jdbc.update(
            "INSERT INTO play_runs(id,user_id,status,play_ticks,current_progress,max_progress,peak_reached_ticks,finish_ticks,started_at,ended_at,updated_at) VALUES (?,?,'FINISHED',?,15000,15000,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            id,
            owners.get(index),
            ticks,
            ticks,
            ticks);
      }
      String bestUnfinished = UUID.randomUUID().toString();
      jdbc.update(
          "INSERT INTO play_runs(id,user_id,status,play_ticks,current_progress,max_progress,peak_reached_ticks,started_at,ended_at,updated_at) VALUES (?,?,'ABANDONED',200,300,10000,100,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          bestUnfinished,
          owners.get(3));
      jdbc.update(
          "INSERT INTO play_runs(id,user_id,status,play_ticks,current_progress,max_progress,peak_reached_ticks,started_at,ended_at,updated_at) VALUES (?,?,'ABANDONED',50,300,9000,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          UUID.randomUUID().toString(),
          owners.get(3));
      jdbc.update(
          "INSERT INTO matches(id,room_code,mode,map_id,started_at,ended_at,duration_ticks,end_reason) VALUES (?,'ABCDEF','RACE',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1,'FINISH')",
          match);
      jdbc.update(
          "INSERT INTO play_runs(id,user_id,match_id,status,play_ticks,current_progress,max_progress,peak_reached_ticks,finish_ticks,`rank`,started_at,ended_at,updated_at) VALUES (?,?,?,'FINISHED',1,15000,15000,1,1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          UUID.randomUUID().toString(),
          owners.get(3),
          match);
      var entries = records.leaderboard(100);
      assertThat(entries.subList(0, 3))
          .extracting(RecordsDto.LeaderboardEntry::rank)
          .containsExactly(1L, 1L, 3L);
      assertThat(entries.subList(0, 3))
          .extracting(RecordsDto.LeaderboardEntry::id)
          .containsExactlyInAnyOrderElementsOf(ids);
      var peak =
          entries.stream()
              .filter(entry -> entry.id().equals(bestUnfinished))
              .findFirst()
              .orElseThrow();
      assertThat(peak.maxProgress()).isEqualTo(10000);
      assertThat(peak.peakReachedTimeMs()).isEqualTo(1666);
      assertThat(peak.finishTimeMs()).isNull();
      assertThat(entries.stream().filter(entry -> entry.username().equals(peak.username())).count())
          .isEqualTo(1);
      assertThat(records.leaderboard(2))
          .extracting(RecordsDto.LeaderboardEntry::rank)
          .containsExactly(1L, 1L);
      assertThatThrownBy(() -> records.leaderboard(0))
          .isInstanceOf(jumpking.exception.ApiException.class);
    } finally {
      for (long owner : owners) {
        jdbc.update("DELETE FROM play_runs WHERE user_id=?", owner);
        jdbc.update("DELETE FROM users WHERE id=?", owner);
      }
      jdbc.update("DELETE FROM matches WHERE id=?", match);
    }
  }
}
