package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import jumpking.JumpKingApplication;
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
  private static final int VITE_PORT = freePort();
  @LocalServerPort int port;
  @Autowired PasswordEncoder passwords;
  @Autowired jumpking.service.CommunityRuns communityRuns;
  @Autowired jumpking.game.SharedData shared;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper json;

  private record FinishFixture(long owner, String username, String password, String run) {}

  private record AdventureFixture(String username, String password) {}

  private AdventureFixture adventureFixture() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String
        name =
            "adventure_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
        password = java.util.UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(type,username,password_hash,created_at) VALUES ('ACCOUNT',?,?,UTC_TIMESTAMP(3))",
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
    communityRuns.open(owner, false, null, game.snapshot());
    return new AdventureFixture(name, password);
  }

  private FinishFixture finishFixture() throws Exception {
    var jdbc = TestDatabase.get().jdbc;
    String
        name = "finish_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12),
        password = java.util.UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(type,username,password_hash,created_at) VALUES ('ACCOUNT',?,?,UTC_TIMESTAMP(3))",
        name,
        passwords.encode(password));
    long owner = jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
    var before = jumpking.support.MainBabeRoute.beforeFinish(shared, json);
    var stored = communityRuns.open(owner, false, null, before);
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

  private static int freePort() {
    try (var socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    } catch (java.io.IOException error) {
      throw new IllegalStateException(error);
    }
  }

  @Test
  void accountFormsUseRealBackendAndMySql() throws Exception {
    var frontend = Path.of("../client").toFile();
    var viteBuilder =
        new ProcessBuilder(
                "node",
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                Integer.toString(VITE_PORT),
                "--strictPort")
            .directory(frontend);
    viteBuilder.environment().put("BACKEND_URL", "http://127.0.0.1:" + port);
    Process vite =
        viteBuilder
            .redirectErrorStream(true)
            .redirectOutput(Path.of("target/auth-vite-test.log").toFile())
            .start();
    Process browser = null;
    try (var http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(1))
            .build()) {
      String origin = "http://127.0.0.1:" + VITE_PORT;
      boolean ready = false;
      for (int attempt = 0; attempt < 80; attempt++) {
        assertThat(vite.isAlive()).as("Inspect target/auth-vite-test.log").isTrue();
        try {
          if (http.send(
                      HttpRequest.newBuilder(URI.create(origin))
                          .timeout(Duration.ofSeconds(1))
                          .build(),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode()
              == 200) {
            ready = true;
            break;
          }
        } catch (java.io.IOException notReady) {
        }
        Thread.sleep(250);
      }
      assertThat(ready).isTrue();
      String specs = System.getenv().getOrDefault("E2E_SPECS", ALL_SPECS);
      var builder =
          new ProcessBuilder(
                  "node", "node_modules/@playwright/test/cli.js", "test", specs, "--workers=1")
              .directory(frontend);
      builder.environment().put("E2E_BASE_URL", origin);
      builder.environment().put("E2E_AUTH_ONLINE", "true");
      builder.environment().put("E2E_OUTPUT_DIR", "../../.local/browser-online-tests");
      var finish = finishFixture();
      builder.environment().put("E2E_FINISH_USERNAME", finish.username);
      builder.environment().put("E2E_FINISH_PASSWORD", finish.password);
      builder.environment().put("E2E_FINISH_RUN", finish.run);
      var adventure = adventureFixture();
      builder.environment().put("E2E_ADVENTURE_USERNAME", adventure.username);
      builder.environment().put("E2E_ADVENTURE_PASSWORD", adventure.password);
      browser =
          builder
              .redirectErrorStream(true)
              .redirectOutput(Path.of("target/auth-browser-test.log").toFile())
              .start();
      assertThat(browser.waitFor(600, TimeUnit.SECONDS))
          .as("Browser test timeout; inspect target/auth-browser-test.log")
          .isTrue();
      assertThat(browser.exitValue())
          .as("Inspect target/auth-browser-test.log and client/test-results")
          .isZero();
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
    } finally {
      if (browser != null && browser.isAlive()) {
        browser.destroyForcibly();
        browser.waitFor(5, TimeUnit.SECONDS);
      }
      vite.destroy();
      if (!vite.waitFor(10, TimeUnit.SECONDS)) {
        vite.destroyForcibly();
        vite.waitFor(5, TimeUnit.SECONDS);
      }
    }
  }
}
