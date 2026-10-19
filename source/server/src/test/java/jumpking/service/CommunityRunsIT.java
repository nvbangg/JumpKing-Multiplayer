package jumpking.service;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import jumpking.exception.ApiException;
import jumpking.game.*;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

@org.springframework.boot.test.context.SpringBootTest(classes = jumpking.JumpKingApplication.class)
class CommunityRunsIT {
  @org.springframework.test.context.DynamicPropertySource
  static void database(org.springframework.test.context.DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  static JdbcTemplate jdbc;
  @org.springframework.beans.factory.annotation.Autowired CommunityRuns records;
  static SharedData shared;
  static ObjectMapper json = new ObjectMapper();

  @BeforeAll
  static void setup() throws Exception {
    var db = TestDatabase.get();
    jdbc = db.jdbc;
    shared = new SharedData(json);
  }

  long account() {
    String name = "checkpoint_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    jdbc.update(
        "INSERT INTO users(username,password_hash,created_at) VALUES (?,'unused-test-hash',UTC_TIMESTAMP(3))",
        name);
    return jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
  }

  GameSimulation game() {
    return new GameSimulation(
        json.convertValue(shared.map(), GameMap.class),
        new Physics(
            json.convertValue(
                shared.physics(),
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Number>>() {})),
        shared.adventure(),
        false,
        false);
  }

  CommunityRuns.Write progressed(CommunityRuns.Stored stored, long revision) {
    var game = game();
    game.restore(stored.snapshot());
    double maximum = stored.maximum();
    long peak = stored.peak();
    for (int tick = 0; tick < 100; tick++) {
      game.tick(new PlayerInput(false, false, tick < 15));
      if (game.physics().progress() > maximum) {
        maximum = game.physics().progress();
        peak = game.physics().snapshot().ticks;
      }
    }
    return new CommunityRuns.Write(
        stored.id(),
        stored.owner(),
        revision,
        "ACTIVE",
        game.snapshot(),
        game.physics().progress(),
        maximum,
        peak,
        null);
  }

  @Test
  void communityPersistsRavenFlightWithoutSharingItWithAnotherAccountOrNewRun() {
    long owner = account();
    var game = game();
    var player = game.physics().snapshot();
    player.screen = 2;
    player.x = 25;
    player.y = 88 - 720 - 13;
    for (int tick = 0; tick < 10; tick++) game.adventure().tick(player, PlayerInput.NEUTRAL);
    var raven = game.adventure().snapshot().path("raven");
    assertThat(raven.path("flying").asBoolean()).isTrue();
    player.screen = 0;
    player.x = 201;
    player.y = 18;
    for (int tick = 0; tick < 5; tick++) game.adventure().tick(player, PlayerInput.NEUTRAL);
    var whiteRaven = game.adventure().snapshot().path("whiteRaven");
    assertThat(whiteRaven.path("flying").asBoolean()).isTrue();
    raven = game.adventure().snapshot().path("raven");
    var stored = records.open(owner, true, null, game.snapshot());
    var continued = records.open(owner, false, stored.id(), game().snapshot());
    var restored = game();
    restored.restore(continued.snapshot());
    assertThat(restored.adventure().snapshot().path("raven")).isEqualTo(raven);
    assertThat(restored.adventure().snapshot().path("whiteRaven")).isEqualTo(whiteRaven);
    var other = records.open(account(), true, null, game().snapshot());
    assertThat(other.snapshot().adventure().path("raven").path("flying").asBoolean()).isFalse();
    assertThat(other.snapshot().adventure().path("whiteRaven").path("flying").asBoolean())
        .isFalse();
    var next = records.open(owner, true, stored.id(), game().snapshot());
    assertThat(next.snapshot().adventure().path("raven").path("index").asInt()).isZero();
    assertThat(next.snapshot().adventure().path("raven").path("flying").asBoolean()).isFalse();
    assertThat(next.snapshot().adventure().path("whiteRaven").path("index").asInt()).isZero();
    assertThat(next.snapshot().adventure().path("whiteRaven").path("flying").asBoolean()).isFalse();
  }

  @Test
  void continueRestoresSavedCurrentProgressInsteadOfAirborneHeightAndNewRunResetsIt() {
    long owner = account();
    var game = game();
    var initial = records.open(owner, true, null, game.snapshot());
    assertThat(initial.progress()).isZero();
    for (int tick = 0; tick < 40; tick++) game.tick(new PlayerInput(false, false, true));
    assertThat(game.physics().snapshot().grounded).isFalse();
    double maximum = game.physics().progress();
    assertThat(maximum).isGreaterThan(12.5);
    records.save(
        new CommunityRuns.Write(
            initial.id(),
            owner,
            2,
            "ACTIVE",
            game.snapshot(),
            12.5,
            maximum,
            game.physics().snapshot().ticks,
            null));
    var continued = records.open(owner, false, initial.id(), game().snapshot());
    assertThat(continued.progress()).isEqualTo(12.5);
    assertThat(continued.maximum()).isEqualTo(maximum);
    assertThat(continued.snapshot().physics().grounded).isFalse();
    var next = records.open(owner, true, initial.id(), game().snapshot());
    assertThat(next.progress()).isZero();
  }

  @Test
  void concurrentContinueRestoresExactlyOneActiveRunAndRejectsUnknownOwner() throws Exception {
    long owner = account();
    var spawn = game().snapshot();
    var initial = records.open(owner, true, null, spawn);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var first = pool.submit(() -> records.open(owner, false, initial.id(), spawn));
      var second = pool.submit(() -> records.open(owner, false, initial.id(), spawn));
      assertThat(first.get(5, TimeUnit.SECONDS).id())
          .isEqualTo(second.get(5, TimeUnit.SECONDS).id());
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=? AND kind='COMMUNITY' AND status='ACTIVE'",
                Integer.class,
                owner))
        .isEqualTo(1);
    assertThatThrownBy(() -> records.open(Long.MAX_VALUE, false, null, spawn))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void concurrentNewGamesReplaceTheExpectedSaveOnlyOnce() throws Exception {
    long owner = account();
    var spawn = game().snapshot();
    var initial = records.open(owner, true, null, spawn);
    Callable<String> replace =
        () -> {
          try {
            return records.open(owner, true, initial.id(), spawn).id();
          } catch (ApiException conflict) {
            assertThat(conflict.status()).isEqualTo(409);
            return null;
          }
        };
    try (var pool = Executors.newFixedThreadPool(2)) {
      var first = pool.submit(replace);
      var second = pool.submit(replace);
      assertThat(Arrays.asList(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS)))
          .containsOnlyOnce((String) null)
          .filteredOn(Objects::nonNull)
          .hasSize(1);
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=?", Integer.class, owner))
        .isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=? AND status='ACTIVE'",
                Integer.class,
                owner))
        .isEqualTo(1);
  }

  @Test
  void continueNeverCreatesOrReplacesASaveAndRejectsStaleIds() {
    long owner = account();
    var spawn = game().snapshot();
    assertThatThrownBy(() -> records.open(owner, false, null, spawn))
        .isInstanceOf(ApiException.class);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=?", Integer.class, owner))
        .isZero();
    var first = records.open(owner, true, null, spawn);
    assertThatThrownBy(() -> records.open(owner, false, null, spawn))
        .isInstanceOf(ApiException.class);
    var next = records.open(owner, true, first.id(), spawn);
    assertThatThrownBy(() -> records.open(owner, false, first.id(), spawn))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> records.open(owner, true, first.id(), spawn))
        .isInstanceOf(ApiException.class);
    assertThat(records.open(owner, false, next.id(), spawn).id()).isEqualTo(next.id());
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=?", Integer.class, owner))
        .isEqualTo(2);
  }

  @Test
  void saveIsOwnerScopedRevisionedIdempotentAndCountersCannotDecrease() throws Exception {
    long owner = account();
    var initial = records.open(owner, true, null, game().snapshot());
    var write = progressed(initial, 2);
    records.save(write);
    records.save(write);
    var restored = records.open(owner, false, initial.id(), game().snapshot());
    assertThat(restored.id()).isEqualTo(initial.id());
    assertThat(restored.revision()).isEqualTo(2);
    // JSON/MySQL chuẩn hóa kiểu số nguyên; so sánh hai state sau cùng một JSON codec.
    assertThat(json.readTree(json.writeValueAsString(restored.snapshot())))
        .isEqualTo(json.readTree(json.writeValueAsString(write.snapshot())));
    assertThatThrownBy(
            () ->
                records.save(
                    new CommunityRuns.Write(
                        write.id(),
                        account(),
                        3,
                        "ACTIVE",
                        write.snapshot(),
                        write.progress(),
                        write.maximum(),
                        write.peak(),
                        null)))
        .isInstanceOf(ApiException.class);
    var changed =
        new CommunityRuns.Write(
            write.id(),
            owner,
            2,
            "ACTIVE",
            write.snapshot(),
            write.progress(),
            write.maximum() + 1,
            write.peak(),
            null);
    assertThatThrownBy(() -> records.save(changed)).isInstanceOf(ApiException.class);
    records.save(
        new CommunityRuns.Write(
            initial.id(), owner, 1, "ACTIVE", initial.snapshot(), 0, 0, 0, null));
    assertThatThrownBy(
            () ->
                records.save(
                    new CommunityRuns.Write(
                        initial.id(), owner, 3, "ACTIVE", initial.snapshot(), 0, 0, 0, null)))
        .isInstanceOf(ApiException.class);
    assertThat(
            jdbc.queryForObject(
                "SELECT play_ticks FROM play_runs WHERE id=?", Long.class, initial.id()))
        .isEqualTo(write.snapshot().physics().ticks);
  }

  @Test
  void newRunChecksExpectedIdRollsBackOnInsertFailureAndLateWriterCannotRestoreOldRun() {
    long owner = account();
    var initial = records.open(owner, true, null, game().snapshot());
    var write = progressed(initial, 2);
    records.save(write);
    assertThatThrownBy(
            () -> records.open(owner, true, UUID.randomUUID().toString(), game().snapshot()))
        .isInstanceOf(ApiException.class);
    String trigger = "checkpoint_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute(
        "CREATE TRIGGER "
            + trigger
            + " BEFORE INSERT ON play_runs FOR EACH ROW BEGIN IF NEW.user_id="
            + owner
            + " AND NEW.kind='COMMUNITY' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected test failure'; END IF; END");
    try {
      assertThatThrownBy(() -> records.open(owner, true, initial.id(), game().snapshot()))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
    } finally {
      jdbc.execute("DROP TRIGGER " + trigger);
    }
    var retained = records.open(owner, false, initial.id(), game().snapshot());
    assertThat(retained.id()).isEqualTo(initial.id());
    assertThat(retained.revision()).isEqualTo(2);
    var next = records.open(owner, true, initial.id(), game().snapshot());
    assertThat(next.id()).isNotEqualTo(initial.id());
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM play_runs WHERE id=?", String.class, initial.id()))
        .isEqualTo("ABANDONED");
    assertThatThrownBy(
            () ->
                records.save(
                    new CommunityRuns.Write(
                        initial.id(),
                        owner,
                        20,
                        "ACTIVE",
                        write.snapshot(),
                        write.progress(),
                        write.maximum(),
                        write.peak(),
                        null)))
        .isInstanceOf(ApiException.class);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE user_id=? AND kind='COMMUNITY' AND status='ACTIVE'",
                Integer.class,
                owner))
        .isEqualTo(1);
  }

  @Test
  void finishUnlocksCrownInTheSameTransactionAndNewRunKeepsIt() throws Exception {
    long owner = account();
    var initial = records.open(owner, true, null, game().snapshot());
    var finished = game();
    finished.restore(jumpking.support.MainBabeRoute.beforeFinish(shared, json));
    finished.tick(PlayerInput.NEUTRAL);
    assertThat(finished.finished()).isTrue();
    var write =
        new CommunityRuns.Write(
            initial.id(),
            owner,
            2,
            "FINISHED",
            finished.snapshot(),
            finished.physics().progress(),
            finished.physics().progress(),
            finished.physics().snapshot().ticks,
            java.time.Instant.now());
    String trigger = "crown_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute(
        "CREATE TRIGGER "
            + trigger
            + " BEFORE UPDATE ON users FOR EACH ROW BEGIN IF NEW.id="
            + owner
            + " AND NEW.crown_unlocked THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected crown failure'; END IF; END");
    try {
      assertThatThrownBy(() -> records.save(write))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
    } finally {
      jdbc.execute("DROP TRIGGER " + trigger);
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM play_runs WHERE id=?", String.class, initial.id()))
        .isEqualTo("ACTIVE");
    assertThat(
            jdbc.queryForObject(
                "SELECT crown_unlocked FROM users WHERE id=?", Boolean.class, owner))
        .isFalse();
    records.save(write);
    records.save(write);
    assertThat(
            jdbc.queryForObject(
                "SELECT crown_unlocked FROM users WHERE id=?", Boolean.class, owner))
        .isTrue();
    assertThatThrownBy(() -> records.open(owner, false, initial.id(), game().snapshot()))
        .isInstanceOf(ApiException.class);
    records.open(owner, true, null, game().snapshot());
    assertThat(
            jdbc.queryForObject(
                "SELECT crown_unlocked FROM users WHERE id=?", Boolean.class, owner))
        .isTrue();
  }
}
