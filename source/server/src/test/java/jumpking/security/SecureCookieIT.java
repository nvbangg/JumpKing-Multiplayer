package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import jumpking.JumpKingApplication;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "server.servlet.session.cookie.secure=true",
      "server.servlet.session.cookie.same-site=none"
    })
class SecureCookieIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;

  @Test
  void httpsConfigurationMarksSessionCookieSecureBeforeAndAfterAuthentication() throws Exception {
    try (var http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()) {
      String origin = "http://127.0.0.1:" + port;
      var csrf =
          http.send(
              HttpRequest.newBuilder(URI.create(origin + "/api/auth/csrf")).build(),
              HttpResponse.BodyHandlers.ofString());
      String cookie = csrf.headers().firstValue("set-cookie").orElseThrow();
      assertThat(cookie)
          .contains("Secure", "HttpOnly", "SameSite=None", "Path=/", "Max-Age=2592000")
          .doesNotContain("Domain=");
      String token = new ObjectMapper().readTree(csrf.body()).path("token").asText();
      // HTTP loopback chỉ dùng kiểm tra headers; gửi cookie thủ công vì browser sẽ đòi HTTPS.
      var account =
          http.send(
              HttpRequest.newBuilder(URI.create(origin + "/api/auth/login"))
                  .header("Cookie", cookie.split(";", 2)[0])
                  .header("X-CSRF-TOKEN", token)
                  .header("Content-Type", "application/json")
                  .POST(
                      HttpRequest.BodyPublishers.ofString(
                          new ObjectMapper()
                              .writeValueAsString(
                                  java.util.Map.of(
                                      "username",
                                      "secure_"
                                          + java.util.UUID.randomUUID().toString().substring(0, 12),
                                      "password",
                                      "A secure integration password"))))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(account.statusCode()).isEqualTo(200);
      assertThat(account.headers().firstValue("set-cookie").orElseThrow())
          .contains(
              "JSESSIONID=", "Secure", "HttpOnly", "SameSite=None", "Path=/", "Max-Age=2592000")
          .doesNotContain("Domain=");
      String authenticatedCookie =
          account.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
      var refreshed =
          http.send(
              HttpRequest.newBuilder(URI.create(origin + "/api/auth/csrf"))
                  .header("Cookie", authenticatedCookie)
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      var logout =
          http.send(
              HttpRequest.newBuilder(URI.create(origin + "/api/auth/logout"))
                  .header("Cookie", authenticatedCookie)
                  .header(
                      "X-CSRF-TOKEN",
                      new ObjectMapper().readTree(refreshed.body()).path("token").asText())
                  .POST(HttpRequest.BodyPublishers.noBody())
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(logout.statusCode()).isEqualTo(200);
      assertThat(logout.headers().firstValue("set-cookie").orElseThrow())
          .contains("JSESSIONID=", "SameSite=None", "Secure", "HttpOnly", "Max-Age=0");
    }
  }
}
