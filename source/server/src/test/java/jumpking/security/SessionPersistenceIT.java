package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

class SessionPersistenceIT {
  private final ObjectMapper json = new ObjectMapper();

  private ConfigurableApplicationContext start(int port, Path store) {
    return start(port, store, Clock.systemUTC());
  }

  private ConfigurableApplicationContext start(int port, Path store, Clock clock) {
    var db = TestDatabase.get().dataSource;
    return new SpringApplicationBuilder(JumpKingApplication.class)
        .initializers(
            context ->
                ((GenericApplicationContext) context)
                    .registerBean(
                        "restartTestClock",
                        Clock.class,
                        () -> clock,
                        bean -> bean.setPrimary(true)))
        .run(
            "--spring.profiles.active=prod",
            "--server.port=" + port,
            "--server.address=127.0.0.1",
            "--spring.config.import=",
            "--spring.datasource.url=" + db.getUrl(),
            "--spring.datasource.username=" + db.getUsername(),
            "--spring.datasource.password=" + db.getPassword(),
            "--server.servlet.session.store-dir=" + store.toAbsolutePath(),
            "--server.servlet.session.cookie.secure=false",
            "--app.allowed-origins=http://127.0.0.1:" + port);
  }

  private void assertRegistered(
      ConfigurableApplicationContext application, String sessionId, boolean expected) {
    var registry =
        (Map<?, ?>)
            ReflectionTestUtils.getField(application.getBean(SessionAuthority.class), "sessions");
    assertThat(registry).isNotNull();
    assertThat(registry.containsKey(sessionId)).isEqualTo(expected);
  }

  private final class Client implements AutoCloseable {
    final HttpClient http =
        HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
    final String origin;
    String csrf;

    Client(int port) {
      origin = "http://127.0.0.1:" + port;
    }

    HttpResponse<String> send(String path, Object body) throws Exception {
      var request = HttpRequest.newBuilder(URI.create(origin + "/api" + path));
      if (body == null) request.GET();
      else {
        request.header("Content-Type", "application/json").header("X-CSRF-TOKEN", csrf);
        request.POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
      }
      return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    void token() throws Exception {
      var response = send("/auth/csrf", null);
      assertThat(response.statusCode()).isEqualTo(200);
      csrf = json.readTree(response.body()).path("token").asText();
    }

    void login(String name) throws Exception {
      token();
      assertThat(
              send("/auth/login", Map.of("username", name, "password", "A secure test password"))
                  .statusCode())
          .isEqualTo(200);
      token();
    }

    boolean authenticated() throws Exception {
      var response = send("/auth/me", null);
      assertThat(response.statusCode()).isEqualTo(200);
      return json.readTree(response.body()).path("authenticated").asBoolean();
    }

    String sessionId() {
      return ((CookieManager) http.cookieHandler().orElseThrow())
          .getCookieStore().getCookies().stream()
              .filter(cookie -> cookie.getName().equals("JSESSIONID"))
              .findFirst()
              .orElseThrow()
              .getValue()
              .replace("\"", "");
    }

    @Override
    public void close() {
      http.close();
    }
  }

  @Test
  void gracefulRestartRestoresCookiesCsrfAndRegistryAndDoesNotResurrectRevokedSessions(
      @TempDir Path store) throws Exception {
    int port;
    try (var socket = new ServerSocket(0)) {
      port = socket.getLocalPort();
    }
    String name = "persist_" + UUID.randomUUID().toString().replace("-", "").substring(0, 15);
    try (var a = new Client(port);
        var b = new Client(port);
        var c = new Client(port)) {
      try (var application = start(port, store)) {
        a.login(name);
        b.login(name);
        c.login(name + "x");
      }
      try (var application = start(port, store)) {
        // Registry phải có cả phiên chưa gửi request sau restart để thu hồi đủ các thiết bị.
        var authority = application.getBean(SessionAuthority.class);
        assertRegistered(application, a.sessionId(), true);
        assertRegistered(application, b.sessionId(), true);
        assertThat(authority.find(a.sessionId())).isNotNull();
        assertThat(authority.find(b.sessionId())).isNotNull();
        assertThat(a.authenticated()).isTrue();
        assertThat(c.authenticated()).isTrue();
        assertThat(
                a.send(
                        "/auth/password",
                        Map.of(
                            "currentPassword",
                            "A secure test password",
                            "newPassword",
                            "A changed test password"))
                    .statusCode())
            .isEqualTo(200);
        assertThat(b.authenticated()).isFalse();
        assertThat(c.send("/auth/logout", Map.of()).statusCode()).isEqualTo(200);
      }
      try (var application = start(port, store)) {
        assertThat(a.authenticated()).isFalse();
        assertThat(b.authenticated()).isFalse();
        assertThat(c.authenticated()).isFalse();
      }
    }
  }

  @ParameterizedTest(name = "restart respects absolute timeout: {0}")
  @ValueSource(booleans = {false, true})
  void downtimeDoesNotRenewExpiredSessions(boolean absolute, @TempDir Path store) throws Exception {
    int port;
    try (var socket = new ServerSocket(0)) {
      port = socket.getLocalPort();
    }
    var now = new AtomicLong(System.currentTimeMillis());
    Clock clock =
        new Clock() {
          @Override
          public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
          }

          @Override
          public Clock withZone(java.time.ZoneId zone) {
            return Clock.fixed(instant(), zone);
          }

          @Override
          public Instant instant() {
            return Instant.ofEpochMilli(now.get());
          }
        };
    String name = "expiry_" + UUID.randomUUID().toString().replace("-", "").substring(0, 15);
    try (var client = new Client(port)) {
      String sessionId;
      try (var application = start(port, store, clock)) {
        client.login(name);
        sessionId = client.sessionId();
        var authority = application.getBean(SessionAuthority.class);
        var session = authority.find(sessionId);
        assertThat(session).isNotNull();
        if (absolute) {
          // Duy trì hoạt động để chỉ hạn tuyệt đối hết trong thời gian server dừng.
          for (int index = 0; index < 143; index++) {
            now.addAndGet(Duration.ofMinutes(10).toMillis());
            assertThat(authority.valid(session, true)).isTrue();
          }
        }
        assertThat(client.authenticated()).isTrue();
      }
      // Tiến đồng hồ sau khi Tomcat đã ghi phiên còn hạn, trước khi nạp lại từ đĩa.
      now.addAndGet(Duration.ofMinutes(absolute ? 10 : 30).toMillis() - 1);
      try (var application = start(port, store, clock)) {
        assertRegistered(application, sessionId, true);
        assertThat(application.getBean(SessionAuthority.class).find(sessionId)).isNotNull();
        // Không gửi HTTP/gia hạn activity ở mốc trước deadline.
      }
      now.incrementAndGet();
      try (var application = start(port, store, clock)) {
        // Kiểm tra trước find()/HTTP vì chính các thao tác đó cũng có thể loại phiên hết hạn.
        assertRegistered(application, sessionId, false);
        assertThat(application.getBean(SessionAuthority.class).find(sessionId)).isNull();
        assertThat(client.authenticated()).isFalse();
        assertThat(client.send("/profile/me", null).statusCode()).isEqualTo(401);
        assertThat(client.send("/auth/logout", Map.of()).statusCode()).isEqualTo(403);
      }
    }
  }
}
