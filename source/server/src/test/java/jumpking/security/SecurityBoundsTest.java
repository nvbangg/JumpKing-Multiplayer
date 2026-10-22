package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;

class SecurityBoundsTest {
  private SecuritySettings settings(String origin) {
    return new SecuritySettings(List.of(origin), Duration.ofHours(24), 20, 16384, 10000);
  }

  @Test
  void rejectsWildcardCredentialsPathsAndInvalidSecurityBounds() {
    for (String origin :
        List.of(
            "*",
            "null",
            "https://user:pass@example.com",
            "https://example.com/path",
            "file://example.com",
            "https://example.com?secret=yes")) {
      assertThatThrownBy(() -> settings(origin)).isInstanceOf(IllegalArgumentException.class);
    }
    var settings = settings("https://game.example.com");
    assertThat(settings.acceptsOrigin("https://game.example.com")).isTrue();
    assertThat(settings.acceptsOrigin("https://game.example.com.evil.test")).isFalse();
    assertThat(settings.acceptsOrigin(null)).isFalse();
    assertThatThrownBy(
            () ->
                new SecuritySettings(
                    List.of("https://example.com"), Duration.ZERO, 20, 16384, 10000))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void identityBucketSurvivesIpChangesAndCapacityFailsClosed() {
    var clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);
    var limits = new AuthRateLimiter(clock, settings("https://example.com"));
    for (int index = 0; index < 20; index++) limits.check("ip" + index, "account:42");
    assertThatThrownBy(() -> limits.check("another-ip", "account:42"))
        .isInstanceOfSatisfying(
            ApiException.class,
            error -> {
              assertThat(error.status()).isEqualTo(429);
              assertThat(error.code()).isEqualTo("RATE_LIMITED");
            });
    var bounded =
        new AuthRateLimiter(
            clock,
            new SecuritySettings(
                List.of("https://example.com"), Duration.ofHours(24), 20, 16384, 1));
    bounded.check("one", null);
    assertThatThrownBy(() -> bounded.check("two", null)).isInstanceOf(ApiException.class);
  }

  @Test
  void minuteBoundaryResetsAuthAndCapacityTogether() {
    var now = new java.util.concurrent.atomic.AtomicLong(59_999);
    var clock = mock(Clock.class);
    when(clock.millis()).thenAnswer(call -> now.get());
    var limits =
        new AuthRateLimiter(
            clock,
            new SecuritySettings(
                List.of("https://example.com"), Duration.ofHours(24), 2, 16384, 2));
    for (int index = 0; index < 2; index++) {
      limits.check("one", null);
    }
    limits.check("two", null);
    assertThatThrownBy(() -> limits.check("one", null)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> limits.check("three", null)).isInstanceOf(ApiException.class);
    now.set(60_000);
    limits.check("two", null);
    limits.check("two", null);
    assertThatThrownBy(() -> limits.check("two", null)).isInstanceOf(ApiException.class);
  }
}
