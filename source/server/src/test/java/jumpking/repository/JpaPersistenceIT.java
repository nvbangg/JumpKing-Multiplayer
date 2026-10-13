package jumpking.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import jumpking.JumpKingApplication;
import jumpking.entity.Match;
import jumpking.entity.PlayRun;
import jumpking.entity.User;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(classes = JumpKingApplication.class)
@Transactional
class JpaPersistenceIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired UserRepository users;
  @Autowired MatchRepository matches;
  @Autowired PlayRunRepository runs;
  @Autowired jakarta.persistence.EntityManager entityManager;

  @Test
  void mapsExistingMysqlTypesAndPreservesCheckpointJson() {
    var now = Instant.parse("2026-10-15T00:00:00.123Z");
    var owner =
        users.saveAndFlush(
            User.account("jpa_" + UUID.randomUUID().toString().substring(0, 8), "hash", now));
    var run = new PlayRun();
    run.setId(UUID.randomUUID().toString());
    run.setUserId(owner.getId());
    run.setKind("COMMUNITY");
    run.setStatus("ACTIVE");
    run.setRevision(1);
    run.setSnapshot("{\"physics\":{\"ticks\":0},\"world\":{}}");
    run.setStartedAt(now);
    run.setUpdatedAt(now);
    runs.saveAndFlush(run);
    var match = new Match();
    match.setId(UUID.randomUUID().toString());
    match.setRoomCode("ABCDEF");
    match.setMode("TIME_LIMIT");
    match.setTimeLimitMinutes(5);
    match.setStartedAt(now);
    matches.saveAndFlush(match);
    entityManager.clear();
    assertThat(users.findById(owner.getId()).orElseThrow().getCreatedAt()).isEqualTo(now);
    assertThat(runs.findById(run.getId()).orElseThrow().getSnapshot()).contains("physics");
    assertThat(matches.findById(match.getId()).orElseThrow().getTimeLimitMinutes()).isEqualTo(5);
  }
}
