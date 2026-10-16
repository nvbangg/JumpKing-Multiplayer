package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
import jumpking.dto.SoloMetrics;
import jumpking.security.SessionAuthority;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = {JumpKingApplication.class, IdentityIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.allowed-origins=http://allowed.test")
class IdentityIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @TestConfiguration
  static class TimeConfiguration {
    @Bean
    @Primary
    MutableClock testClock() {
      return new MutableClock();
    }
  }

  static class MutableClock extends Clock {
    private final AtomicLong time = new AtomicLong(System.currentTimeMillis());

    void advance(long milliseconds) {
      time.addAndGet(milliseconds);
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(time.get());
    }
  }

  @LocalServerPort int port;
  @Autowired MutableClock clock;
  @Autowired SessionAuthority sessions;
  @Autowired ObjectMapper json;
  @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;

  @BeforeEach
  void nextWindow() {
    clock.advance(120_000);
  }

  private Client client() {
    return new Client();
  }

  private class Client implements AutoCloseable {
    final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    final HttpClient http =
        HttpClient.newBuilder().cookieHandler(cookies).version(HttpClient.Version.HTTP_1_1).build();
    String csrf;

    HttpResponse<String> send(String path, String method, String body, String... headers)
        throws Exception {
      var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api" + path));
      if (csrf != null && !method.equals("GET")) request.header("X-CSRF-TOKEN", csrf);
      if (body != null) request.header("Content-Type", "application/json");
      for (int index = 0; index < headers.length; index += 2)
        request.header(headers[index], headers[index + 1]);
      request.method(
          method,
          body == null
              ? HttpRequest.BodyPublishers.noBody()
              : HttpRequest.BodyPublishers.ofString(body));
      return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    void token() throws Exception {
      var response = send("/auth/csrf", "GET", null);
      assertThat(response.statusCode()).isEqualTo(200);
      csrf = tree(response).path("token").asText();
    }

    String cookie(String name) {
      return cookies.getCookieStore().getCookies().stream()
          .filter(cookie -> cookie.getName().equals(name))
          .findFirst()
          .orElseThrow()
          .getValue();
    }

    @Override
    public void close() {
      http.close();
    }
  }

  private JsonNode tree(HttpResponse<String> response) throws Exception {
    return json.readTree(response.body());
  }

  private String unique() {
    return java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 20);
  }

  private String registration(String username, String password) throws Exception {
    return json.writeValueAsString(java.util.Map.of("username", username, "password", password));
  }

  private void roomHistory(long owner) {
    String match = java.util.UUID.randomUUID().toString();
    var jdbc = TestDatabase.get().jdbc;
    jdbc.update(
        "INSERT INTO matches(id,room_code,mode,started_at) VALUES (?,'ABCDEF','RACE',UTC_TIMESTAMP(3))",
        match);
    roomFixtures.add(match);
    jdbc.update(
        "INSERT INTO play_runs(id,user_id,kind,match_id,status,nickname,started_at,updated_at) VALUES (?,?,'ROOM',?,'ACTIVE','Historical Player',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        java.util.UUID.randomUUID().toString(),
        owner,
        match);
  }

  private final java.util.List<String> roomFixtures = new java.util.ArrayList<>();

  @org.junit.jupiter.api.AfterEach
  void cleanupRoomFixtures() {
    var jdbc = TestDatabase.get().jdbc;
    for (String id : roomFixtures) {
      jdbc.update("DELETE FROM play_runs WHERE match_id=?", id);
      jdbc.update("DELETE FROM matches WHERE id=?", id);
    }
  }

  private String metrics(long revision, long ticks, String status) throws Exception {
    var body =
        json.createObjectNode()
            .put("revision", revision)
            .put("status", status)
            .put("playTicks", ticks)
            .put("jumps", ticks > 0 ? 1 : 0)
            .put("falls", 0)
            .put("currentProgress", 0)
            .put("maxProgress", 0)
            .put("peakReachedTicks", 0)
            .put("startedAt", "2026-01-01T00:00:00.000Z");
    if (status.equals("FINISHED")) body.put("finishTicks", ticks);
    else body.putNull("finishTicks");
    if (status.equals("ACTIVE")) body.putNull("endedAt");
    else body.put("endedAt", "2026-01-01T00:00:10.000Z");
    return body.toString();
  }

  @Test
  void soloSyncIsRevisionedOwnerScopedAndStatsHistoryCountCommittedRunsOnce() throws Exception {
    try (var client = client();
        var other = client()) {
      client.token();
      assertThat(
              client
                  .send("/auth/register", "POST", registration(unique(), "A secure solo password"))
                  .statusCode())
          .isEqualTo(200);
      client.token();
      String account =
          tree(client.send("/auth/me", "GET", null)).path("account").path("id").asText();
      String id = java.util.UUID.randomUUID().toString(), path = "/solo/runs/" + id;
      assertThat(
              client
                  .send(path, "PUT", metrics(1, 60, "ACTIVE"), "X-Account-ID", "wrong-account")
                  .statusCode())
          .isEqualTo(409);
      assertThat(
              client
                  .send(path, "PUT", metrics(1, 60, "ACTIVE"), "X-Account-ID", account)
                  .statusCode())
          .isEqualTo(200);
      assertThat(client.send(path, "PUT", metrics(1, 60, "ACTIVE")).statusCode()).isEqualTo(200);
      assertThat(client.send(path, "PUT", metrics(1, 120, "ACTIVE")).statusCode()).isEqualTo(409);
      assertThat(client.send(path, "PUT", metrics(2, 120, "ACTIVE")).statusCode()).isEqualTo(200);
      assertThat(tree(client.send(path, "PUT", metrics(1, 60, "ACTIVE"))).path("revision").asLong())
          .isEqualTo(1);
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject("SELECT play_ticks FROM play_runs WHERE id=?", Long.class, id))
          .isEqualTo(120);
      assertThat(client.send(path, "PUT", metrics(3, 120, "FINISHED")).statusCode()).isEqualTo(200);
      assertThat(
              tree(client.send("/auth/me", "GET", null))
                  .path("account")
                  .path("crownUnlocked")
                  .asBoolean())
          .isTrue();
      assertThat(client.send("/profile/crown", "POST", null).statusCode()).isEqualTo(404);
      assertThat(client.send(path, "PUT", metrics(4, 180, "ACTIVE")).statusCode()).isEqualTo(409);
      String second = java.util.UUID.randomUUID().toString();
      assertThat(
              client.send("/solo/runs/" + second, "PUT", metrics(1, 60, "ABANDONED")).statusCode())
          .isEqualTo(200);
      var stats = tree(client.send("/profile/me", "GET", null)).path("total");
      assertThat(stats.path("totalPlayTimeMs").asLong()).isEqualTo(3000);
      assertThat(stats.path("totalJumps").asLong()).isEqualTo(2);
      assertThat(stats.path("finishes").asLong()).isEqualTo(1);
      assertThat(stats.path("bestFinishTimeMs").asLong()).isEqualTo(2000);
      var history = tree(client.send("/history?page=0&size=1", "GET", null));
      assertThat(history.path("items").size()).isEqualTo(1);
      assertThat(history.path("hasNext").asBoolean()).isTrue();
      assertThat(tree(client.send("/history/SOLO/" + id, "GET", null)).path("status").asText())
          .isEqualTo("FINISHED");
      other.token();
      assertThat(
              other
                  .send("/auth/register", "POST", registration(unique(), "Another solo password"))
                  .statusCode())
          .isEqualTo(200);
      other.token();
      assertThat(other.send(path, "PUT", metrics(4, 180, "ACTIVE")).statusCode()).isEqualTo(404);
      assertThat(other.send("/history/SOLO/" + id, "GET", null).statusCode()).isEqualTo(404);
      assertThat(client.send("/history?page=invalid", "GET", null).statusCode()).isEqualTo(400);
    }
  }

  @Test
  void soloSyncRejectsScalarCoercionUnknownFieldsAndForeignKinds() throws Exception {
    try (var client = client()) {
      client.token();
      assertThat(
              client
                  .send("/auth/register", "POST", registration(unique(), "A strict solo password"))
                  .statusCode())
          .isEqualTo(200);
      client.token();
      String path = "/solo/runs/" + java.util.UUID.randomUUID();
      for (String body :
          java.util.List.of(
              metrics(1, 60, "ACTIVE").replace("\"revision\":1", "\"revision\":\"1\""),
              metrics(1, 60, "ACTIVE").replace("\"revision\":1", "\"revision\":1.5"),
              metrics(1, 60, "ACTIVE").replace("\"status\":\"ACTIVE\"", "\"status\":0"),
              metrics(1, 60, "ACTIVE")
                  .replace("\"startedAt\":\"2026-01-01T00:00:00.000Z\"", "\"startedAt\":0"),
              metrics(1, 60, "ACTIVE").replace("}", ",\"snapshot\":{}}"),
              metrics(SoloMetrics.MAX_SAFE_INTEGER + 1, 60, "ACTIVE"))) {
        assertThat(client.send(path, "PUT", body).statusCode()).as(body).isEqualTo(400);
      }
      long owner = tree(client.send("/auth/me", "GET", null)).path("account").path("id").asLong();
      roomHistory(owner);
      String roomRun =
          TestDatabase.get()
              .jdbc
              .queryForObject("SELECT id FROM play_runs WHERE user_id=?", String.class, owner);
      TestDatabase.get()
          .jdbc
          .update(
              "UPDATE play_runs SET status='DNF',ended_at=UTC_TIMESTAMP(3) WHERE id=?", roomRun);
      assertThat(client.send("/solo/runs/" + roomRun, "PUT", metrics(1, 60, "ACTIVE")).statusCode())
          .isEqualTo(404);
    }
  }

  @Test
  void soloQuotaCountsInvalidRequestsAndLargeTickTotalsDoNotOverflow() throws Exception {
    try (var client = client()) {
      client.token();
      assertThat(
              client
                  .send("/auth/register", "POST", registration(unique(), "A bounded Solo password"))
                  .statusCode())
          .isEqualTo(200);
      client.token();
      String first = "/solo/runs/" + java.util.UUID.randomUUID(),
          second = "/solo/runs/" + java.util.UUID.randomUUID();
      assertThat(
              client
                  .send(first, "PUT", metrics(1, SoloMetrics.MAX_SAFE_INTEGER, "ACTIVE"))
                  .statusCode())
          .isEqualTo(200);
      assertThat(
              client
                  .send(second, "PUT", metrics(1, SoloMetrics.MAX_SAFE_INTEGER, "ACTIVE"))
                  .statusCode())
          .isEqualTo(200);
      var expected =
          java.math.BigInteger.valueOf(SoloMetrics.MAX_SAFE_INTEGER)
              .multiply(java.math.BigInteger.valueOf(2000))
              .divide(java.math.BigInteger.valueOf(60));
      assertThat(
              tree(client.send("/profile/me", "GET", null))
                  .path("total")
                  .path("totalPlayTimeMs")
                  .bigIntegerValue())
          .isEqualTo(expected);
      assertThat(client.send(first, "PUT", "{invalid-json").statusCode()).isEqualTo(400);
      for (int index = 0; index < 57; index++)
        assertThat(
                client
                    .send(first, "PUT", metrics(1, SoloMetrics.MAX_SAFE_INTEGER, "ACTIVE"))
                    .statusCode())
            .isEqualTo(200);
      var limited = client.send(first, "PUT", metrics(1, SoloMetrics.MAX_SAFE_INTEGER, "ACTIVE"));
      assertThat(limited.statusCode()).isEqualTo(429);
      assertThat(limited.headers().firstValue("Retry-After")).contains("60");
    }
  }

  @Test
  void publicMapAndConfigComeFromPackagedSharedDataAndServerFlags() throws Exception {
    try (var client = client()) {
      var map = client.send("/map", "GET", null);
      var config = client.send("/game-config", "GET", null);
      assertThat(map.statusCode()).isEqualTo(200);
      assertThat(config.statusCode()).isEqualTo(200);
      var shared = new jumpking.game.SharedData(json);
      assertThat(tree(map)).isEqualTo(shared.map());
      assertThat(tree(config).path("features").path("flyEnabled").asBoolean()).isFalse();
      assertThat(config.body()).doesNotContain("password", "allowed-origins");
    }
  }

  @Test
  void enforcesCsrfCorsPrivateAccessAndSafeJsonErrors() throws Exception {
    try (var client = client()) {
      var response = client.send("/auth/csrf", "GET", null);
      client.csrf = tree(response).path("token").asText();
      assertThat(response.headers().firstValue("set-cookie").orElseThrow())
          .contains("HttpOnly", "SameSite=Lax", "Path=/")
          .doesNotContain("Domain=");
      assertThat(
              client.send("/auth/guest", "POST", null, "Origin", "http://evil.test").statusCode())
          .isEqualTo(403);
      assertThat(
              tree(client.send("/auth/guest", "POST", null, "Origin", "null"))
                  .path("error")
                  .path("code")
                  .asText())
          .isEqualTo("ORIGIN_DENIED");
      var preflight =
          client.send(
              "/auth/guest",
              "OPTIONS",
              null,
              "Origin",
              "http://allowed.test",
              "Access-Control-Request-Method",
              "POST",
              "Access-Control-Request-Headers",
              "x-csrf-token,content-type");
      assertThat(preflight.statusCode()).isEqualTo(200);
      assertThat(preflight.headers().firstValue("access-control-allow-credentials"))
          .contains("true");
      assertThat(client.send("/community/current", "GET", null).statusCode()).isEqualTo(401);
      client.csrf = "invalid";
      assertThat(tree(client.send("/auth/guest", "POST", null)).path("error").path("code").asText())
          .isEqualTo("CSRF");
      var missing = client.send("/missing", "GET", null);
      assertThat(missing.statusCode()).isEqualTo(404);
      assertThat(tree(missing).path("error").path("code").asText()).isEqualTo("NOT_FOUND");
      assertThat(missing.headers().firstValue("cache-control")).contains("no-store");
    }
  }

  @Test
  void limitsBodyIncludingChunkedRequestsAndKeepsIpBucketAcrossSessionChanges() throws Exception {
    try (var client = client()) {
      client.token();
      assertThat(client.send("/auth/login", "POST", " ".repeat(16385)).statusCode()).isEqualTo(400);
      var chunked =
          HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/auth/login"))
              .header("Content-Type", "application/json")
              .header("X-CSRF-TOKEN", client.csrf)
              .POST(
                  HttpRequest.BodyPublishers.ofInputStream(
                      () -> new java.io.ByteArrayInputStream(new byte[16385])))
              .build();
      assertThat(client.http.send(chunked, HttpResponse.BodyHandlers.ofString()).statusCode())
          .isEqualTo(400);
      clock.advance(120_000);
      for (int index = 0; index < 20; index++)
        assertThat(
                client
                    .send(
                        "/auth/login",
                        "POST",
                        "{\"username\":\"missing\",\"password\":\"incorrect\"}")
                    .statusCode())
            .isEqualTo(401);
      client.cookies.getCookieStore().removeAll();
      client.token();
      assertThat(
              client
                  .send(
                      "/auth/login",
                      "POST",
                      "{\"username\":\"missing\",\"password\":\"incorrect\"}")
                  .statusCode())
          .isEqualTo(429);
    }
  }

  @Test
  void expiresIdleAndAbsoluteSessionsButValidActivityOnlyExtendsIdle() throws Exception {
    try (var client = client()) {
      client.token();
      String sessionId = client.cookie("JSESSIONID");
      var session = sessions.find(sessionId);
      assertThat(session).isNotNull();
      clock.advance(29 * 60_000);
      assertThat(sessions.valid(session, false)).isTrue();
      clock.advance(60_000);
      var expired = client.send("/auth/me", "GET", null);
      assertThat(expired.statusCode()).isEqualTo(401);
      assertThat(tree(expired).path("error").path("code").asText()).isEqualTo("SESSION_EXPIRED");
      assertThat(sessions.find(sessionId)).isNull();
      client.cookies.getCookieStore().removeAll();
      client.token();
      sessionId = client.cookie("JSESSIONID");
      session = sessions.find(sessionId);
      for (int index = 0; index < 47; index++) {
        clock.advance(30 * 60_000 - 1);
        assertThat(sessions.valid(session, true)).isTrue();
      }
      clock.advance(30 * 60_000 - 1);
      assertThat(sessions.valid(session, true)).isTrue();
      clock.advance(48);
      assertThat(sessions.valid(session, true)).isFalse();
      assertThat(sessions.find(sessionId)).isNull();
    }
  }

  @Test
  void rejectsWebSocketWithoutAnAllowedOrigin() throws Exception {
    try (var client = client()) {
      var request =
          HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/ws/game")).GET().build();
      var response = client.http.send(request, HttpResponse.BodyHandlers.ofString());
      assertThat(response.statusCode()).isEqualTo(403);
      assertThat(tree(response).path("error").path("code").asText()).isEqualTo("ORIGIN_DENIED");
    }
  }

  @Test
  void registrationRotatesSessionAndCsrfAndLogoutRevokesSession() throws Exception {
    try (var client = client();
        var attacker = client()) {
      client.token();
      String previous = client.cookie("JSESSIONID"), oldCsrf = client.csrf;
      String name = "player_" + unique(), password = "A secure test password";
      var response = client.send("/auth/register", "POST", registration(name, password));
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(tree(response).path("authenticated").asBoolean()).isTrue();
      assertThat(tree(response).path("account").path("id").isTextual()).isTrue();
      String id = client.cookie("JSESSIONID");
      assertThat(id).isNotEqualTo(previous);
      assertThat(sessions.find(previous)).isNull();
      String hash =
          TestDatabase.get()
              .jdbc
              .queryForObject(
                  "SELECT password_hash FROM users WHERE username=?", String.class, name);
      assertThat(hash).startsWith("$2").isNotEqualTo(password);
      assertThat(passwords.matches(password, hash)).isTrue();
      assertThat(sessions.find(id).getAttribute("SPRING_SECURITY_CONTEXT").toString())
          .doesNotContain(password, hash);
      assertThat(
              tree(attacker.send("/auth/me", "GET", null, "Cookie", "JSESSIONID=" + previous))
                  .path("authenticated")
                  .asBoolean())
          .isFalse();
      client.csrf = oldCsrf;
      assertThat(client.send("/auth/logout", "POST", null).statusCode()).isEqualTo(403);
      client.token();
      assertThat(client.send("/auth/logout", "POST", null).statusCode()).isEqualTo(200);
      assertThat(sessions.find(id)).isNull();
      assertThat(tree(client.send("/auth/me", "GET", null)).path("authenticated").asBoolean())
          .isFalse();
    }
  }

  @Test
  void validatesUnicodePasswordsStrictJsonAndUniqueCredentials() throws Exception {
    try (var client = client();
        var second = client()) {
      client.token();
      String name = unique();
      for (String body :
          java.util.List.of(
              registration("ab", "password123"),
              registration("invalid name", "password123"),
              registration(name, "short"),
              registration(name, "é".repeat(37)),
              registration(name, "password123").replace("}", ",\"admin\":true}"))) {
        assertThat(client.send("/auth/register", "POST", body).statusCode())
            .as(body)
            .isEqualTo(400);
      }
      assertThat(
              client
                  .send("/auth/register", "POST", registration(name, "😀".repeat(18)))
                  .statusCode())
          .isEqualTo(200);
      second.token();
      var duplicate = second.send("/auth/register", "POST", registration(name, "password123"));
      assertThat(duplicate.statusCode()).isEqualTo(409);
      assertThat(duplicate.body()).doesNotContain("SQL", "uq_users");
    }
  }

  @Test
  void passwordChangeRequiresOldPasswordAndRevokesEverySession() throws Exception {
    String name = unique(),
        password = "Original password 123",
        replacement = "Replacement password 456";
    try (var first = client();
        var other = client()) {
      first.token();
      assertThat(first.send("/auth/register", "POST", registration(name, password)).statusCode())
          .isEqualTo(200);
      first.token();
      other.token();
      assertThat(
              other
                  .send(
                      "/auth/login",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of("username", name, "password", password)))
                  .statusCode())
          .isEqualTo(200);
      other.token();
      assertThat(
              first
                  .send(
                      "/auth/password",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of("currentPassword", "wrong", "newPassword", replacement)))
                  .statusCode())
          .isEqualTo(401);
      assertThat(
              first
                  .send(
                      "/auth/password",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of(
                              "currentPassword", password, "newPassword", replacement)))
                  .statusCode())
          .isEqualTo(200);
      assertThat(tree(other.send("/auth/me", "GET", null)).path("authenticated").asBoolean())
          .isFalse();
      first.token();
      assertThat(
              first
                  .send(
                      "/auth/login",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of("username", name, "password", password)))
                  .statusCode())
          .isEqualTo(401);
      assertThat(
              first
                  .send(
                      "/auth/login",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of("username", name, "password", replacement)))
                  .statusCode())
          .isEqualTo(200);
    }
  }

  @Test
  void anonymousUsersCannotCreateOnlineIdentityOrReadPrivateHistory() throws Exception {
    try (var client = client()) {
      client.token();
      assertThat(client.send("/auth/guest", "POST", null).statusCode()).isEqualTo(404);
      assertThat(client.send("/history", "GET", null).statusCode()).isEqualTo(401);
      assertThat(client.send("/community/current", "GET", null).statusCode()).isEqualTo(401);
      assertThat(
              client
                  .send(
                      "/auth/password",
                      "POST",
                      json.writeValueAsString(
                          java.util.Map.of(
                              "currentPassword", "wrong", "newPassword", "Replacement password")))
                  .statusCode())
          .isEqualTo(401);
    }
  }
}
