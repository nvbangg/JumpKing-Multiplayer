package jumpking.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app")
public record PersistenceSettings(
    long checkpointIntervalMs,
    int persistenceRetryCount,
    long persistenceRetryDelayMs,
    int persistenceThreads,
    int persistenceQueue,
    int persistenceRunQueue) {
  public PersistenceSettings {
    if (checkpointIntervalMs < 1
        || persistenceRetryCount < 0
        || persistenceRetryCount > 10
        || persistenceRetryDelayMs < 1
        || persistenceThreads < 1
        || persistenceQueue < 1
        || persistenceRunQueue < 1)
      throw new IllegalArgumentException("Invalid persistence limits");
  }
}
