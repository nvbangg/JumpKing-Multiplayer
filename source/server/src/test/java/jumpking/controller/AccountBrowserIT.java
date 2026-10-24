package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.support.BrowserHarness;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@EnabledIfEnvironmentVariable(named = "E2E_BROWSER_PATH", matches = ".+")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AccountBrowserIT {
  private static final String ALL_SPECS = "e2e/.*-online.spec.ts";
  private static final int VITE_PORT = BrowserHarness.freePort();
  @LocalServerPort int port;
  @Autowired PasswordEncoder passwords;
  @Autowired jumpking.service.CommunityRuns communityRuns;
  @Autowired jumpking.game.SharedData shared;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper json;

  private record FinishFixture(long owner, String username, String password, String run) {}

  private record AccountFixture(String username, String password) {}

  private AccountFixture adventureFixture() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String
        name =
            "adventure_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
        password = java.util.UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(username,password_hash,created_at) VALUES (?,?,UTC_TIMESTAMP(3))",
        name,
        passwords.encode(password));
    long owner = jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
    var game =
        new jumpking.game.GameSimulation(
            json.treeToValue(shared.map(), jumpking.game.GameMap.class),
            new jumpking.game.Physics(
                json.convertValue(
                    shared.physics(),
                    new com.fasterxml.jackson.core.type.TypeReference<
                        java.util.Map<String, Number>>() {})),
            shared.adventure(),
            false,
            false);
    var physics = game.physics().snapshot();
    game.physics().restore(physics);
    communityRuns.open(owner, true, null, game.snapshot());
    return new AccountFixture(name, password);
  }

  // Chuẩn bị trang History qua service thật, không flood Join hoặc nới rate limit.
  private AccountFixture historyFixture() throws Exception {
    var fixture = adventureFixture();
    var jdbc = TestDatabase.get().jdbc;
    long owner =
        jdbc.queryForObject(
            "SELECT id FROM users WHERE username=?", Long.class, fixture.username());
    String id =
        jdbc.queryForObject(
            "SELECT id FROM play_runs WHERE user_id=? AND kind='COMMUNITY' AND status='ACTIVE'",
            String.class,
            owner);
    var snapshot =
        json.readValue(
            jdbc.queryForObject("SELECT snapshot FROM play_runs WHERE id=?", String.class, id),
            jumpking.game.GameSimulation.Snapshot.class);
    for (int index = 0; index < 21; index++)
      id = communityRuns.open(owner, true, id, snapshot).id();
    return fixture;
  }

  private FinishFixture finishFixture() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String
        name = "finish_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
        password = java.util.UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(username,password_hash,created_at) VALUES (?,?,UTC_TIMESTAMP(3))",
        name,
        passwords.encode(password));
    long owner = jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
    var before = jumpking.support.MainBabeRoute.beforeFinish(shared, json);
    var perch = shared.adventure().path("raven").path("positions").get(13);
    ((com.fasterxml.jackson.databind.node.ObjectNode) before.adventure().path("raven"))
        .put("index", 13)
        .put("done", true)
        .put("flying", false)
        .put("x", perch.path("x").asDouble())
        .put("y", perch.path("y").asDouble() - perch.path("screen").asInt() * 360);
    var stored = communityRuns.open(owner, true, null, before);
    var physics = before.physics();
    double progress =
        Math.max(
            0,
            shared.map().path("progressOriginY").asDouble()
                - physics.y
                - shared.physics().path("bodyHeight").asDouble());
    communityRuns.save(
        new jumpking.service.CommunityRuns.Write(
            stored.id(), owner, 2, "ACTIVE", before, progress, progress, physics.ticks, null));
    return new FinishFixture(owner, name, password, stored.id());
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add("app.allowed-origins", () -> "http://127.0.0.1:" + VITE_PORT);
  }

  @Test
  void accountFormsUseRealBackendAndMySql() throws Exception {
    String specs = System.getenv().getOrDefault("E2E_SPECS", ALL_SPECS);
    var finish = finishFixture();
    var adventure = adventureFixture();
    var history = historyFixture();
    BrowserHarness.run(
        port,
        VITE_PORT,
        "auth",
        specs,
        Map.of(
            "E2E_AUTH_ONLINE", "true",
            "E2E_FINISH_USERNAME", finish.username,
            "E2E_FINISH_PASSWORD", finish.password,
            "E2E_FINISH_RUN", finish.run,
            "E2E_ADVENTURE_USERNAME", adventure.username,
            "E2E_ADVENTURE_PASSWORD", adventure.password,
            "E2E_HISTORY_USERNAME", history.username(),
            "E2E_HISTORY_PASSWORD", history.password()),
        Duration.ofSeconds(900));
    // Các fixtures này chỉ được hoàn tất khi chạy toàn bộ scenarios online.
    if (specs.equals(ALL_SPECS)) {
      var jdbc = TestDatabase.get().jdbc;
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE id=? AND status='FINISHED' AND snapshot IS NULL AND finish_ticks=16957",
                  Integer.class,
                  finish.run))
          .isEqualTo(1);
    }
  }
}
