package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import jakarta.servlet.http.HttpSessionEvent;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.config.SecuritySettings;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mock.web.MockHttpSession;

class SessionAuthorityTest {
  private final AtomicLong now = new AtomicLong(1_000_000);
  private final Clock clock = mock(Clock.class);

  private SessionAuthority authority() {
    // Thời hạn test khác nhau để phân biệt idle và absolute, độc lập mặc định sản phẩm.
    when(clock.millis()).thenAnswer(call -> now.get());
    var server = new ServerProperties();
    server.getServlet().getSession().setTimeout(Duration.ofMinutes(30));
    return new SessionAuthority(
        clock,
        new SecuritySettings(
            List.of("https://game.test"), Duration.ofHours(24), 20, 16384, 10000, null),
        server,
        mock(ApplicationEventPublisher.class));
  }

  @Test
  void restoredMetadataRetainsIdleDeadlineAndRegistersSessionForWebSocket() {
    var before = authority();
    var session = new MockHttpSession();
    before.sessionCreated(new HttpSessionEvent(session));
    now.addAndGet(Duration.ofMinutes(29).toMillis());
    var after = authority();
    assertThat(after.valid(session, false)).isTrue();
    assertThat(after.find(session.getId())).isSameAs(session);
    now.addAndGet(Duration.ofMinutes(1).toMillis());
    assertThat(after.valid(session, false)).isFalse();
    assertThat(session.isInvalid()).isTrue();
  }

  @Test
  void restoredActivityIsPersistedButAbsoluteDeadlineNeverRestarts() {
    var before = authority();
    var session = new MockHttpSession();
    before.sessionCreated(new HttpSessionEvent(session));
    long created = now.get();
    for (int index = 0; index < 143; index++) {
      now.addAndGet(Duration.ofMinutes(10).toMillis());
      assertThat(before.valid(session, true)).isTrue();
    }
    var after = authority();
    assertThat(after.valid(session, false)).isTrue();
    now.set(created + Duration.ofHours(24).toMillis());
    assertThat(after.valid(session, true)).isFalse();
  }

  @Test
  void restoredSessionWithoutMetadataFailsClosed() {
    var session = new MockHttpSession();
    assertThat(authority().valid(session, false)).isFalse();
    assertThat(session.isInvalid()).isTrue();
  }
}
