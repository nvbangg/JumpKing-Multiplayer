package jumpking.security;

import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.springframework.stereotype.Component;

@Component
public class AuthRateLimiter {
  private final Map<String, Integer> buckets = new HashMap<>();
  private long currentWindow = Long.MIN_VALUE;
  private final Clock clock;
  private final SecuritySettings settings;

  public AuthRateLimiter(Clock clock, SecuritySettings settings) {
    this.clock = clock;
    this.settings = settings;
  }

  public synchronized void checkIp(String ip) {
    refreshWindow();
    consume("ip:" + ip, settings.authRatePerMinute());
  }

  public synchronized void checkAccount(long owner) {
    refreshWindow();
    consume("account:" + owner, settings.authRatePerMinute());
  }

  private void refreshWindow() {
    long window = Math.floorDiv(clock.millis(), 60_000);
    if (window != currentWindow) {
      buckets.clear();
      currentWindow = window;
    }
  }

  private void consume(String key, int limit) {
    Integer old = buckets.get(key);
    if ((old == null && buckets.size() >= settings.rateBucketLimit())
        || (old != null && old >= limit)) {
      throw new ApiException(429, "RATE_LIMITED", "Too many requests; try again later");
    }
    buckets.put(key, old == null ? 1 : old + 1);
  }
}
