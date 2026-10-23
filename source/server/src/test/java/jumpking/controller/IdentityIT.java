package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

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

    @Bean
    @Primary
    jumpking.security.GoogleTokenVerifier testGoogleVerifier() {
      return idToken -> {
        if ("valid-google-token".equals(idToken)) {
          return new jumpking.security.GoogleTokenVerifier.Profile(
              "google-test-id-123", "tester@gmail.com", "Google Tester");
        }
        if ("valid-google-token-2".equals(idToken)) {
          return new jumpking.security.GoogleTokenVerifier.Profile(
              "google-test-id-456", "another@gmail.com", "Google Tester");
        }
        throw new jumpking.exception.ApiException(
            401, "INVALID_CREDENTIALS", "Google ID token is invalid");
      };
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
  @MockitoSpyBean org.springframework.security.crypto.password.PasswordEncoder passwords;

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

  private long accountCount() {
    return TestDatabase.get().jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class);
  }

  private String passwordHash(String username) {
    return TestDatabase.get()
        .jdbc
        .queryForObject("SELECT password_hash FROM users WHERE username=?", String.class, username);
  }

  @Test
  void unifiedLoginCreatesAndReopensAnAccountWithThirtyTwoUnicodeCodePoints() throws Exception {
    String name = unique().substring(0, 12) + "\uD840\uDC00".repeat(20);
    String password = "Unicode account password";
    try (var client = client()) {
      client.token();
      long count = accountCount();
      var created = client.send("/auth/login", "POST", registration(name, password));
      assertThat(created.statusCode()).isEqualTo(200);
      assertThat(tree(created).path("account").path("username").asText()).isEqualTo(name);
      String hash = passwordHash(name);
      client.token();
      assertThat(client.send("/auth/logout", "POST", null).statusCode()).isEqualTo(200);
      client.token();
      var reopened = client.send("/auth/login", "POST", registration(name, password));
      assertThat(reopened.statusCode()).isEqualTo(200);
      assertThat(tree(reopened)).isEqualTo(tree(created));
      assertThat(accountCount()).isEqualTo(count + 1);
      assertThat(passwordHash(name)).isEqualTo(hash);
    }
  }

  @Test
  void existingCredentialsNeverCreateAccountsOrChangeThePassword() throws Exception {
    String name = unique(), password = "Existing account password";
    try (var registered = client();
        var login = client()) {
      registered.token();
      var original = registered.send("/auth/register", "POST", registration(name, password));
      assertThat(original.statusCode()).isEqualTo(200);
      long count = accountCount();
      String hash = passwordHash(name);
      login.token();
      var invalid = login.send("/auth/login", "POST", registration(name, "wrong"));
      assertThat(invalid.statusCode()).isEqualTo(401);
      assertThat(tree(invalid).path("error").path("code").asText())
          .isEqualTo("INVALID_CREDENTIALS");
      assertThat(accountCount()).isEqualTo(count);
      assertThat(passwordHash(name)).isEqualTo(hash);
      assertThat(tree(login.send("/auth/me", "GET", null)).path("authenticated").asBoolean())
          .isFalse();
      var valid = login.send("/auth/login", "POST", registration(name, password));
      assertThat(valid.statusCode()).isEqualTo(200);
      assertThat(tree(valid)).isEqualTo(tree(original));
      assertThat(accountCount()).isEqualTo(count);
      assertThat(passwordHash(name)).isEqualTo(hash);
    }
  }

  @Test
  void newCredentialsCreateOneAccountAndRotateTheNormalSessionAndCsrf() throws Exception {
    try (var client = client()) {
      client.token();
      String previous = client.cookie("JSESSIONID"), oldCsrf = client.csrf;
      String name = unique(), password = "New account password";
      long count = accountCount();
      var response = client.send("/auth/login", "POST", registration(name, password));
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(tree(response).propertyStream().map(java.util.Map.Entry::getKey))
          .containsExactlyInAnyOrder("authenticated", "account");
      assertThat(tree(response).path("authenticated").asBoolean()).isTrue();
      assertThat(tree(response).path("account").path("username").asText()).isEqualTo(name);
      assertThat(tree(client.send("/auth/me", "GET", null))).isEqualTo(tree(response));
      assertThat(accountCount()).isEqualTo(count + 1);
      assertThat(passwords.matches(password, passwordHash(name))).isTrue();
      assertThat(client.cookie("JSESSIONID")).isNotEqualTo(previous);
      assertThat(sessions.find(previous)).isNull();
      client.csrf = oldCsrf;
      assertThat(client.send("/auth/logout", "POST", null).statusCode()).isEqualTo(403);
      client.token();
      assertThat(client.send("/auth/logout", "POST", null).statusCode()).isEqualTo(200);
    }
  }

  @Test
  void newCredentialsUseRegistrationValidationWithoutCreatingAccounts() throws Exception {
    try (var client = client()) {
      client.token();
      long count = accountCount();
      for (String body :
          java.util.List.of(
              registration("ab", "password123"),
              registration("invalid name", "password123"),
              registration("a".repeat(33), "password123"),
              registration("\uD840\uDC00".repeat(33), "password123"),
              registration(unique(), "short"),
              registration(unique(), "é".repeat(37)),
              registration(unique(), ""),
              registration(unique(), "password123").replace("}", ",\"admin\":true}"),
              "{\"username\":null,\"password\":\"password123\"}",
              "{\"username\":\"" + unique() + "\",\"password\":null}")) {
        var invalid = client.send("/auth/login", "POST", body);
        assertThat(invalid.statusCode()).as(body).isEqualTo(400);
        assertThat(tree(invalid).path("error").path("code").asText()).isEqualTo("VALIDATION");
        assertThat(accountCount()).isEqualTo(count);
      }
    }
  }

  @Test
  void googleLoginCreatesUserAndReusesOnSecondLogin() throws Exception {
    try (var client = client()) {
      client.token();
      long count = accountCount();
      var response = client.send("/auth/google", "POST", "{\"idToken\":\"valid-google-token\"}");
      assertThat(response.statusCode()).isEqualTo(200);
      var json = tree(response);
      assertThat(json.path("authenticated").asBoolean()).isTrue();
      assertThat(json.path("account").path("username").asText()).isEqualTo("Google_Tester");
      assertThat(accountCount()).isEqualTo(count + 1);

      client.token();
      var second = client.send("/auth/google", "POST", "{\"idToken\":\"valid-google-token\"}");
      assertThat(second.statusCode()).isEqualTo(200);
      assertThat(tree(second).path("account").path("id").asText())
          .isEqualTo(json.path("account").path("id").asText());
      assertThat(accountCount()).isEqualTo(count + 1);
    }
  }

  @Test
  void googleLoginRejectsInvalidToken() throws Exception {
    try (var client = client()) {
      client.token();
      var response = client.send("/auth/google", "POST", "{\"idToken\":\"invalid-token\"}");
      assertThat(response.statusCode()).isEqualTo(401);
      assertThat(tree(response).path("error").path("code").asText())
          .isEqualTo("INVALID_CREDENTIALS");
    }
  }

  @Test
  void googleAccountRejectsPasswordChange() throws Exception {
    try (var client = client()) {
      client.token();
      var login = client.send("/auth/google", "POST", "{\"idToken\":\"valid-google-token\"}");
      assertThat(login.statusCode()).isEqualTo(200);

      client.token();
      var change =
          client.send(
              "/auth/password",
              "POST",
              "{\"currentPassword\":\"anyPassword123\",\"newPassword\":\"newPassword123\"}");
      assertThat(change.statusCode()).isEqualTo(409);
      assertThat(tree(change).path("error").path("code").asText()).isEqualTo("CONFLICT");
    }
  }

  @Test
  void signedInSessionCannotCreateAnotherAccountThroughLoginOrRegister() throws Exception {
    try (var client = client()) {
      client.token();
      var original = client.send("/auth/login", "POST", registration(unique(), "password123"));
      assertThat(original.statusCode()).isEqualTo(200);
      client.token();
      long count = accountCount();
      String session = client.cookie("JSESSIONID");
      for (String path : java.util.List.of("/auth/login", "/auth/register")) {
        var conflict = client.send(path, "POST", registration(unique(), "password456"));
        assertThat(conflict.statusCode()).isEqualTo(409);
        assertThat(tree(conflict).path("error").path("code").asText()).isEqualTo("CONFLICT");
        assertThat(tree(client.send("/auth/me", "GET", null))).isEqualTo(tree(original));
        assertThat(client.cookie("JSESSIONID")).isEqualTo(session);
        assertThat(accountCount()).isEqualTo(count);
      }
    }
  }

  @Test
  void concurrentNewCredentialsWithTheSamePasswordShareOneAccount() throws Exception {
    concurrentNewCredentials("Concurrent password", "Concurrent password");
  }

  @Test
  void concurrentNewCredentialsWithDifferentPasswordsNeverOverwriteTheWinner() throws Exception {
    concurrentNewCredentials("First concurrent password", "Second concurrent password");
  }

  private void concurrentNewCredentials(String firstPassword, String secondPassword)
      throws Exception {
    String name = unique();
    long count = accountCount();
    var encoded = new ConcurrentHashMap<String, String>();
    var ready = new CyclicBarrier(2);
    // Chặn sau hash để cả hai request chắc chắn đã lookup username chưa tồn tại.
    doAnswer(
            invocation -> {
              String raw = invocation.getArgument(0).toString();
              String hash = (String) invocation.callRealMethod();
              encoded.put(raw, hash);
              ready.await(10, TimeUnit.SECONDS);
              return hash;
            })
        .when(passwords)
        .encode(
            argThat(raw -> firstPassword.contentEquals(raw) || secondPassword.contentEquals(raw)));
    try (var first = client();
        var second = client();
        var executor = Executors.newFixedThreadPool(2)) {
      first.token();
      second.token();
      var a =
          executor.submit(
              () -> first.send("/auth/login", "POST", registration(name, firstPassword)));
      var b =
          executor.submit(
              () -> second.send("/auth/login", "POST", registration(name, secondPassword)));
      var firstResponse = a.get(20, TimeUnit.SECONDS);
      var secondResponse = b.get(20, TimeUnit.SECONDS);
      String hash = passwordHash(name);
      assertThat(accountCount()).isEqualTo(count + 1);
      assertThat(
              TestDatabase.get()
                  .jdbc
                  .queryForObject("SELECT COUNT(*) FROM users WHERE username=?", Long.class, name))
          .isEqualTo(1L);
      if (firstPassword.equals(secondPassword)) {
        assertThat(firstResponse.statusCode()).isEqualTo(200);
        assertThat(secondResponse.statusCode()).isEqualTo(200);
        assertThat(tree(firstResponse)).isEqualTo(tree(secondResponse));
        assertThat(passwords.matches(firstPassword, hash)).isTrue();
        assertThat(tree(first.send("/auth/me", "GET", null))).isEqualTo(tree(firstResponse));
        assertThat(tree(second.send("/auth/me", "GET", null))).isEqualTo(tree(secondResponse));
      } else {
        assertThat(java.util.List.of(firstResponse.statusCode(), secondResponse.statusCode()))
            .containsExactlyInAnyOrder(200, 401);
        boolean firstWon = firstResponse.statusCode() == 200;
        String winner = firstWon ? firstPassword : secondPassword;
        String loser = firstWon ? secondPassword : firstPassword;
        var rejected = firstWon ? secondResponse : firstResponse;
        assertThat(tree(rejected).path("error").path("code").asText())
            .isEqualTo("INVALID_CREDENTIALS");
        assertThat(hash).isEqualTo(encoded.get(winner));
        assertThat(passwords.matches(winner, hash)).isTrue();
        assertThat(passwords.matches(loser, hash)).isFalse();
        var losingClient = firstWon ? second : first;
        assertThat(
                tree(losingClient.send("/auth/me", "GET", null)).path("authenticated").asBoolean())
            .isFalse();
      }
    }
    org.mockito.Mockito.verify(passwords, org.mockito.Mockito.times(2))
        .encode(
            argThat(raw -> firstPassword.contentEquals(raw) || secondPassword.contentEquals(raw)));
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
              client.send("/auth/login", "POST", null, "Origin", "http://evil.test").statusCode())
          .isEqualTo(403);
      assertThat(
              tree(client.send("/auth/login", "POST", null, "Origin", "null"))
                  .path("error")
                  .path("code")
                  .asText())
          .isEqualTo("ORIGIN_DENIED");
      var preflight =
          client.send(
              "/auth/login",
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
      assertThat(tree(client.send("/auth/login", "POST", null)).path("error").path("code").asText())
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
      String name = "limited_" + unique();
      assertThat(
              client.send("/auth/register", "POST", registration(name, "password123")).statusCode())
          .isEqualTo(200);
      client.token();
      String incorrect = registration(name, "incorrect");
      clock.advance(120_000);
      for (int index = 0; index < 20; index++)
        assertThat(client.send("/auth/login", "POST", incorrect).statusCode()).isEqualTo(401);
      client.cookies.getCookieStore().removeAll();
      client.token();
      assertThat(client.send("/auth/login", "POST", incorrect).statusCode()).isEqualTo(429);
    }
  }

  @Test
  void expiresIdleAndAbsoluteSessionsButValidActivityOnlyExtendsIdle() throws Exception {
    long lifetime = Duration.ofDays(30).toMillis();
    try (var client = client()) {
      client.token();
      String sessionId = client.cookie("JSESSIONID");
      var session = sessions.find(sessionId);
      assertThat(session).isNotNull();
      clock.advance(lifetime - 1);
      assertThat(sessions.valid(session, false)).isTrue();
      clock.advance(1);
      var expired = client.send("/auth/me", "GET", null);
      assertThat(expired.statusCode()).isEqualTo(401);
      assertThat(tree(expired).path("error").path("code").asText()).isEqualTo("SESSION_EXPIRED");
      assertThat(sessions.find(sessionId)).isNull();
      client.cookies.getCookieStore().removeAll();
      client.token();
      sessionId = client.cookie("JSESSIONID");
      session = sessions.find(sessionId);
      clock.advance(lifetime - 1);
      assertThat(sessions.valid(session, true)).isTrue();
      clock.advance(1);
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
      assertThat(tree(response).propertyStream().map(java.util.Map.Entry::getKey))
          .containsExactlyInAnyOrder("authenticated", "account");
      assertThat(tree(response).path("authenticated").asBoolean()).isTrue();
      assertThat(tree(response).path("account").path("id").isTextual()).isTrue();
      assertThat(tree(response).path("account").path("crownUnlocked").isBoolean()).isTrue();
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
