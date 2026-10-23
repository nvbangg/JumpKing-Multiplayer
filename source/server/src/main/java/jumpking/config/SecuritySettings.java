package jumpking.config;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app")
public record SecuritySettings(
    List<String> allowedOrigins,
    Duration sessionAbsoluteTimeout,
    int authRatePerMinute,
    int httpBodyLimit,
    int rateBucketLimit,
    String googleClientId) {
  public SecuritySettings {
    if (allowedOrigins == null || allowedOrigins.isEmpty())
      throw new IllegalArgumentException("An origin allowlist is required");
    allowedOrigins = List.copyOf(allowedOrigins);
    for (String origin : allowedOrigins) {
      URI uri = URI.create(origin);
      if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || (uri.getPath() != null && !uri.getPath().isEmpty()))
        throw new IllegalArgumentException("Invalid allowed origin");
    }
    if (sessionAbsoluteTimeout == null
        || sessionAbsoluteTimeout.isNegative()
        || sessionAbsoluteTimeout.isZero()
        || sessionAbsoluteTimeout.toSeconds() > Integer.MAX_VALUE - 60
        || authRatePerMinute < 1
        || httpBodyLimit < 1
        || rateBucketLimit < 1) throw new IllegalArgumentException("Invalid security bounds");
  }

  public boolean acceptsOrigin(String origin) {
    return origin != null && allowedOrigins.contains(origin);
  }
}
