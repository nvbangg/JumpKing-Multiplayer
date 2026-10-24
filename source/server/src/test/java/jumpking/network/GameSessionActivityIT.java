package jumpking.network;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

import java.net.CookieManager;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
import jumpking.security.SessionAuthority;
import jumpking.service.CrownService;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    classes = {JumpKingApplication.class, GameSessionActivityIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "server.servlet.session.timeout=1m"})
class GameSessionActivityIT {
  static class TestClock extends Clock {
    final AtomicLong now = new AtomicLong(System.currentTimeMillis());

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
      return Instant.ofEpochMilli(now.get());
    }
  }

  @TestConfiguration
  static class TimeConfiguration {
    @Bean
    @Primary
    TestClock testClock() {
      return new TestClock();
    }
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired TestClock clock;
  @Autowired SessionAuthority sessions;
  @MockitoSpyBean CrownService crowns;
  @LocalServerPort int port;

  @ParameterizedTest
  @ValueSource(strings = {"CREATE_ROOM", "JOIN_COMMUNITY"})
  void joinsRenewIdleAtCompletionButHeartbeatAndInvalidCommandsDoNot(String type) throws Exception {
    try (var client = new GameClient(port);
        var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      client.register();
      client.connect();
      var cookies = (CookieManager) client.http.cookieHandler().orElseThrow();
      String id =
          cookies.getCookieStore().getCookies().stream()
              .filter(cookie -> cookie.getName().equals("JSESSIONID"))
              .findFirst()
              .orElseThrow()
              .getValue();
      var session = sessions.find(id);
      assertThat(session).isNotNull();
      var loading = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      doAnswer(
              invocation -> {
                loading.countDown();
                assertThat(release.await(8, TimeUnit.SECONDS)).isTrue();
                return invocation.callRealMethod();
              })
          .when(crowns)
          .unlocked(anyLong());
      clock.now.addAndGet(1_000);
      var payload =
          type.equals("CREATE_ROOM") ? Map.<String, Object>of() : client.communityRequest();
      var joined = executor.submit(() -> client.ok(type, payload));
      try {
        assertThat(loading.await(8, TimeUnit.SECONDS)).isTrue();
        clock.now.addAndGet(58_000);
      } finally {
        release.countDown();
      }
      joined.get(8, TimeUnit.SECONDS);
      clock.now.addAndGet(2_000);
      assertThat(sessions.find(id)).isSameAs(session);
      assertThat(client.command("GET_ROOM_STATE", Map.of("unknown", true)).path("type").asText())
          .isEqualTo("ERROR");
      client.ok("HEARTBEAT", Map.of("nonce", "idle-check"));
      clock.now.addAndGet(57_999);
      assertThat(sessions.find(id)).isSameAs(session);
      clock.now.incrementAndGet();
      assertThat(sessions.find(id)).isNull();
    }
  }
}
