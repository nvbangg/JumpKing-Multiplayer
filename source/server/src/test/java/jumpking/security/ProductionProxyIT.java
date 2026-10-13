package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import jumpking.JumpKingApplication;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@ActiveProfiles("prod")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=https://game.example.com", "app.auth-rate-per-minute=1"})
class ProductionProxyIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;

  private HttpRequest request(String path, String forwardedIp, boolean post) {
    var builder =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api" + path))
            .header("Origin", "https://game.example.com")
            .header("X-Forwarded-For", forwardedIp)
            .header("X-Forwarded-Proto", "https");
    return (post ? builder.POST(HttpRequest.BodyPublishers.noBody()) : builder.GET()).build();
  }

  @Test
  void trustedProxySetsSecureCookiesAndKeepsSeparateClientRateLimits() throws Exception {
    try (var http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()) {
      var csrf =
          http.send(
              request("/auth/csrf", "192.0.2.10", false), HttpResponse.BodyHandlers.ofString());
      assertThat(csrf.statusCode()).isEqualTo(200);
      assertThat(csrf.headers().firstValue("set-cookie").orElseThrow())
          .contains("Secure", "HttpOnly", "SameSite=Lax");
      assertThat(csrf.headers().firstValue("strict-transport-security")).isPresent();
      // Thiếu CSRF bị từ chối nhưng vẫn tiêu thụ quota xác thực của IP.
      assertThat(
              http.send(
                      request("/auth/login", "192.0.2.10", true),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode())
          .isEqualTo(403);
      assertThat(
              http.send(
                      request("/auth/login", "192.0.2.10", true),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode())
          .isEqualTo(429);
      assertThat(
              http.send(
                      request("/auth/login", "192.0.2.11", true),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode())
          .isEqualTo(403);
    }
  }

  @Test
  void untrustedPeerCannotChangeItsRateLimitIdentityWithForwardedHeaders() throws Exception {
    try (var http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .localAddress(InetAddress.getByName("127.0.0.2"))
            .build()) {
      assertThat(
              http.send(
                      request("/auth/login", "192.0.2.20", true),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode())
          .isEqualTo(403);
      assertThat(
              http.send(
                      request("/auth/login", "192.0.2.21", true),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode())
          .isEqualTo(429);
    }
  }
}
