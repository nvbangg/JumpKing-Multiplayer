package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;

@SpringBootTest(
    classes = HealthControllerTest.HttpApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthControllerTest {
  @Configuration(proxyBeanMethods = false)
  @EnableAutoConfiguration(
      exclude = {
        DataSourceAutoConfiguration.class,
        org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration.class,
        org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
            .class
      })
  @Import({HealthController.class, jumpking.config.WebConfiguration.class})
  static class HttpApplication {}

  @Autowired private TestRestTemplate http;

  @Test
  void servesHealthThroughRealHttp() {
    var response = http.getForEntity("/api/health", String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("\"status\":\"UP\"");
  }

  @Test
  void unknownApiReturnsNotFound() {
    assertThat(http.getForEntity("/api/missing", String.class).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void refreshUiRouteServesIndex() {
    var response = http.getForEntity("/history", String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("SPA routing fixture");
  }

  @Test
  void missingAssetsAndWebSocketDoNotReceiveHtml() {
    for (String path :
        new String[] {
          "/assets/missing", "/assets/missing.png", "/ws/game", "/api", "/api/missing"
        }) {
      assertThat(http.getForEntity(path, String.class).getStatusCode())
          .as(path)
          .isEqualTo(HttpStatus.NOT_FOUND);
    }
  }
}
