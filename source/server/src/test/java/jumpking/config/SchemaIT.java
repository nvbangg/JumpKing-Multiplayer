package jumpking.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipFile;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

@org.springframework.boot.test.context.SpringBootTest(classes = jumpking.JumpKingApplication.class)
class SchemaIT {
  @org.springframework.test.context.DynamicPropertySource
  static void database(org.springframework.test.context.DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @org.springframework.beans.factory.annotation.Autowired
  jumpking.repository.SchemaRepository schema;

  private static JdbcTemplate jdbc;
  private static DriverManagerDataSource dataSource;

  @BeforeAll
  static void startDatabase() throws Exception {
    var database = TestDatabase.get();
    dataSource = database.dataSource;
    jdbc = database.jdbc;
  }

  private long account() {
    String token = UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO users(username,password_hash,created_at) VALUES (?,?,UTC_TIMESTAMP(3))",
        token.substring(0, 24),
        "hash");
    return jdbc.queryForObject(
        "SELECT id FROM users WHERE username=?", Long.class, token.substring(0, 24));
  }

  private void community(long userId) {
    jdbc.update(
        "INSERT INTO play_runs(id,user_id,kind,status,snapshot,started_at,updated_at) VALUES (?,?,'COMMUNITY','ACTIVE',JSON_OBJECT('codecVersion',1),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        UUID.randomUUID().toString(),
        userId);
  }

  @Test
  void validatesActualSchemaAndIndexes() {
    schema.validate();
  }

  @Test
  void packagedBackendStartsWithValidatedSchema(@org.junit.jupiter.api.io.TempDir Path setup)
      throws Exception {
    int port;
    try (var socket = new ServerSocket(0)) {
      port = socket.getLocalPort();
    }
    Path log = Path.of("target", "artifact-test.log").toAbsolutePath();
    // Chạy như máy mới: chỉ có JAR và file local từ mẫu, không dựa vào config của developer.
    Path config =
        Files.createDirectories(setup.resolve("config")).resolve("application-local.properties");
    var properties = new java.util.Properties();
    try (var reader =
        Files.newBufferedReader(Path.of("config/application-local.properties.example"))) {
      properties.load(reader);
    }
    properties.setProperty("spring.datasource.url", dataSource.getUrl());
    properties.setProperty("spring.datasource.username", dataSource.getUsername());
    properties.setProperty("spring.datasource.password", dataSource.getPassword());
    properties.setProperty("server.port", Integer.toString(port));
    properties.setProperty(
        "app.allowed-origins", "http://127.0.0.1:" + port + ",http://127.0.0.1:5173");
    try (var writer = Files.newBufferedWriter(config)) {
      properties.store(writer, null);
    }
    var builder =
        new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-jar",
                Path.of("target/jumpking-server.jar").toAbsolutePath().toString(),
                "--spring.profiles.active=local")
            .directory(setup.toFile());
    var environment = builder.environment();
    for (String key :
        new String[] {
          "SPRING_DATASOURCE_URL",
          "SPRING_DATASOURCE_USERNAME",
          "SPRING_DATASOURCE_PASSWORD",
          "SERVER_PORT",
          "SERVER_ADDRESS",
          "APP_ALLOWED_ORIGINS",
          "SPRING_CONFIG_IMPORT",
          "SPRING_CONFIG_LOCATION",
          "SPRING_CONFIG_ADDITIONAL_LOCATION",
          "SPRING_PROFILES_ACTIVE",
          "SPRING_APPLICATION_JSON"
        }) environment.remove(key);
    Process process = builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
    try (var http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(1))
            .build()) {
      String origin = "http://127.0.0.1:" + port;
      HttpResponse<String> response = null;
      for (int attempt = 0; attempt < 80; attempt++) {
        assertThat(process.isAlive())
            .as("Packaged process; inspect target/artifact-test.log on failure")
            .isTrue();
        try {
          response =
              http.send(
                  HttpRequest.newBuilder(URI.create(origin + "/api/health"))
                      .timeout(Duration.ofSeconds(1))
                      .build(),
                  HttpResponse.BodyHandlers.ofString());
          if (response.statusCode() == 200) break;
        } catch (java.io.IOException ignored) {
        }
        Thread.sleep(250);
      }
      assertThat(response).isNotNull();
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(response.body()).contains("\"status\":\"UP\"");
      assertThat(response.headers().firstValue("cache-control").orElseThrow()).contains("no-store");
      try (var archive = new ZipFile("target/jumpking-server.jar")) {
        for (String shared :
            new String[] {"maps/main-babe.json", "physics.json", "rules.json", "adventure.json"}) {
          var entry = archive.getEntry("BOOT-INF/classes/shared/" + shared);
          assertThat(entry).as(shared).isNotNull();
          try (var stream = archive.getInputStream(entry)) {
            assertThat(stream.readAllBytes())
                .isEqualTo(Files.readAllBytes(Path.of("../common", shared)));
          }
        }
        assertThat(archive.getEntry("BOOT-INF/classes/shared/fixtures/physics-traces.json"))
            .isNull();
        if (archive.getEntry("BOOT-INF/classes/static/index.html") != null) {
          for (String path : new String[] {"/", "/history", "/community"}) {
            var page =
                http.send(
                    HttpRequest.newBuilder(URI.create(origin + path)).build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(page.statusCode()).as(path).isEqualTo(200);
            assertThat(page.headers().allValues("set-cookie")).isEmpty();
            assertThat(page.body())
                .contains("<div id=\"root\"></div>")
                .doesNotContain("SPA routing fixture");
            assertThat(page.headers().firstValue("cache-control").orElseThrow())
                .isEqualTo("no-cache");
            var cached =
                http.send(
                    HttpRequest.newBuilder(URI.create(origin + path))
                        .header(
                            "If-Modified-Since",
                            page.headers().firstValue("last-modified").orElseThrow())
                        .build(),
                    HttpResponse.BodyHandlers.discarding());
            assertThat(cached.statusCode()).as("Revalidate " + path).isEqualTo(304);
          }
          verifyViteProxy(http, origin);
          if (System.getenv("E2E_BROWSER_PATH") != null) verifyPackagedBrowser(origin);
        }
      }
      for (String path : new String[] {"/api/missing", "/assets/missing.png"}) {
        assertThat(
                http.send(
                        HttpRequest.newBuilder(URI.create(origin + path))
                            .header("Origin", "http://127.0.0.1:5173")
                            .build(),
                        HttpResponse.BodyHandlers.ofString())
                    .statusCode())
            .isEqualTo(404);
      }
      var unauthorizedSocket =
          http.send(
              HttpRequest.newBuilder(URI.create(origin + "/ws/game"))
                  .header("Origin", "http://127.0.0.1:5173")
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(unauthorizedSocket.statusCode()).isEqualTo(401);
      assertThat(unauthorizedSocket.body()).doesNotContain("<html");
    } finally {
      process.destroy();
      if (!process.waitFor(15, TimeUnit.SECONDS)) {
        process.destroyForcibly();
        process.waitFor(5, TimeUnit.SECONDS);
      }
    }
  }

  private void verifyPackagedBrowser(String origin) throws Exception {
    var builder =
        new ProcessBuilder(
                "node",
                "node_modules/@playwright/test/cli.js",
                "test",
                "e2e/packaged-online.spec.ts",
                "--workers=1")
            .directory(Path.of("../client").toFile());
    builder.environment().put("E2E_BASE_URL", origin);
    builder.environment().put("E2E_PACKAGED", "true");
    builder.environment().put("E2E_OUTPUT_DIR", "../../.local/browser-packaged-tests");
    var browser =
        builder
            .redirectErrorStream(true)
            .redirectOutput(Path.of("target/packaged-browser.log").toFile())
            .start();
    try {
      assertThat(browser.waitFor(90, TimeUnit.SECONDS)).as("Packaged browser timeout").isTrue();
      assertThat(browser.exitValue()).as("Inspect target/packaged-browser.log").isZero();
    } finally {
      if (browser.isAlive()) {
        browser.destroyForcibly();
        browser.waitFor(5, TimeUnit.SECONDS);
      }
    }
  }

  private void verifyViteProxy(HttpClient http, String backend) throws Exception {
    int port;
    try (var socket = new ServerSocket(0)) {
      port = socket.getLocalPort();
    }
    var builder =
        new ProcessBuilder(
            "node",
            "../client/node_modules/vite/bin/vite.js",
            "--host",
            "127.0.0.1",
            "--port",
            Integer.toString(port),
            "--strictPort");
    builder.directory(Path.of("../client").toFile());
    builder.environment().put("BACKEND_URL", backend);
    var vite =
        builder
            .redirectErrorStream(true)
            .redirectOutput(Path.of("target/vite-proxy-test.log").toFile())
            .start();
    try {
      HttpResponse<String> response = null;
      for (int attempt = 0; attempt < 80; attempt++) {
        assertThat(vite.isAlive()).as("Vite proxy; inspect target/vite-proxy-test.log").isTrue();
        try {
          response =
              http.send(
                  HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/health"))
                      .timeout(Duration.ofSeconds(1))
                      .build(),
                  HttpResponse.BodyHandlers.ofString());
          if (response.statusCode() == 200) break;
        } catch (java.io.IOException ignored) {
        }
        Thread.sleep(250);
      }
      assertThat(response).isNotNull();
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(response.body()).contains("\"status\":\"UP\"");
    } finally {
      vite.destroy();
      if (!vite.waitFor(10, TimeUnit.SECONDS)) {
        vite.destroyForcibly();
        vite.waitFor(5, TimeUnit.SECONDS);
      }
    }
  }

  @Test
  void rejectsMissingConstraints() {
    jdbc.execute("ALTER TABLE matches DROP CHECK ck_matches_ticks");
    try {
      assertThatThrownBy(() -> schema.validate()).hasMessageContaining("CHECK");
    } finally {
      jdbc.execute(
          "ALTER TABLE matches ADD CONSTRAINT ck_matches_ticks CHECK (duration_ticks BETWEEN 0 AND 9007199254740991)");
    }
    jdbc.execute("ALTER TABLE matches DROP CHECK ck_matches_map_level");
    try {
      assertThatThrownBy(() -> schema.validate()).hasMessageContaining("CHECK");
    } finally {
      jdbc.execute(
          "ALTER TABLE matches ADD CONSTRAINT ck_matches_map_level CHECK (map_level BETWEEN 1 AND 10)");
    }
  }

  @Test
  void eachAccountHasAtMostOneRunPerRoomMatch() {
    long owner = account(), peer = account();
    String match = UUID.randomUUID().toString();
    jdbc.update(
        "INSERT INTO matches(id,room_code,mode,started_at) VALUES (?,'ABCDEF','RACE',UTC_TIMESTAMP(3))",
        match);
    String insert =
        "INSERT INTO play_runs(id,user_id,kind,match_id,nickname,status,started_at,updated_at) VALUES (?,?,'ROOM',?,'Player','ACTIVE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))";
    jdbc.update(insert, UUID.randomUUID().toString(), owner, match);
    assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID().toString(), owner, match))
        .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
    jdbc.update(insert, UUID.randomUUID().toString(), peer, match);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM play_runs WHERE match_id=?", Integer.class, match))
        .isEqualTo(2);
  }

  @Test
  void oneActiveCommunityAndRollback() {
    long owner = account();
    community(owner);
    assertThatThrownBy(() -> community(owner))
        .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
    var tx = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    assertThatThrownBy(
            () ->
                tx.execute(
                    status -> {
                      jdbc.update(
                          "UPDATE play_runs SET status='ABANDONED',snapshot=NULL,ended_at=UTC_TIMESTAMP(3) WHERE user_id=?",
                          owner);
                      throw new IllegalStateException("rollback");
                    }))
        .hasMessage("rollback");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM play_runs WHERE user_id=?", String.class, owner))
        .isEqualTo("ACTIVE");
  }

  @Test
  void rejectsInvalidIdentityAndNullTimeLimit() {
    assertThatThrownBy(() -> jdbc.update("INSERT INTO users(created_at) VALUES (UTC_TIMESTAMP(3))"))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO matches(id,room_code,mode,started_at) VALUES (?,'ABCDEF','TIME_LIMIT',UTC_TIMESTAMP(3))",
                    UUID.randomUUID().toString()))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    for (int level : new int[] {0, 11})
      assertThatThrownBy(
              () ->
                  jdbc.update(
                      "INSERT INTO matches(id,room_code,mode,map_level,started_at) VALUES (?,'ABCDEF','RACE',?,UTC_TIMESTAMP(3))",
                      UUID.randomUUID().toString(),
                      level))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
  }

  @Test
  void rejectsFinishWithoutTimeAndInvalidSnapshot() {
    long owner = account();
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO play_runs(id,user_id,kind,status,started_at,updated_at,ended_at) VALUES (?,?,'COMMUNITY','FINISHED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    UUID.randomUUID().toString(),
                    owner))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO play_runs(id,user_id,kind,status,snapshot,started_at,updated_at) VALUES (?,?,'COMMUNITY','ACTIVE',JSON_ARRAY(),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                    UUID.randomUUID().toString(),
                    owner))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    community(owner);
    assertThatThrownBy(() -> jdbc.update("DELETE FROM users WHERE id=?", owner))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }
}
