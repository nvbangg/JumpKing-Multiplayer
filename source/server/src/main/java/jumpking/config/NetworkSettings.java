package jumpking.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app.network")
public record NetworkSettings(
    int handshakesPerMinute,
    int connectionsPerIdentity,
    int connectionsPerIp,
    int connections,
    int rooms,
    int joinsPerMinute,
    int messageBytes,
    int messagesPerSecond,
    int inputFrames,
    int controlMessages,
    int commandQueue,
    int workerThreads,
    int sendThreads,
    long sendTimeoutMs,
    long heartbeatExpiryMs,
    long inputTimeoutMs,
    int roomLookupsPerMinute,
    int chatCodePoints,
    int chatHistory,
    long chatIntervalMs) {
  public NetworkSettings {
    if (handshakesPerMinute < 1
        || connectionsPerIdentity < 1
        || connectionsPerIp < 1
        || connections < 1
        || rooms < 1
        || joinsPerMinute < 1
        || messageBytes < 256
        || messagesPerSecond < 1
        || inputFrames < 1
        || controlMessages < 1
        || commandQueue < 1
        || workerThreads < 1
        || sendThreads < 1
        || sendTimeoutMs < 1
        || heartbeatExpiryMs <= sendTimeoutMs
        || inputTimeoutMs < 1
        || roomLookupsPerMinute < 1
        || chatCodePoints < 1
        || chatHistory < 1
        || chatIntervalMs < 1) {
      throw new IllegalArgumentException(
          "Network limits must be positive and heartbeat expiry must exceed send timeout");
    }
  }
}
