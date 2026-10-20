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
import java.util.Map;
import java.util.UUID;
import jumpking.JumpKingApplication;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

class SessionPersistenceIT {
  private final ObjectMapper json = new ObjectMapper();

  private ConfigurableApplicationContext start(int port, Path store) {
    var db = TestDatabase.get().dataSource;
    return new SpringApplicationBuilder(JumpKingApplication.class)
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
}
