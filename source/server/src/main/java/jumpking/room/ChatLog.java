package jumpking.room;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import jumpking.exception.ApiException;

/** Chat chỉ ở RAM của sảnh, không dùng làm tín hiệu hoạt động điều khiển. */
public final class ChatLog {
  public record Message(
      String id, String playerId, String nickname, String text, Instant sentAt, int colorSlot) {}

  private final ArrayDeque<Message> messages = new ArrayDeque<>();
  private final Map<String, Long> lastSent = new HashMap<>();
  private final Clock clock;
  private final MonotonicTime time;
  private final int maximumLength, historySize;
  private final long intervalNs;

  public ChatLog(
      Clock clock, MonotonicTime time, int maximumLength, int historySize, long intervalMs) {
    this.clock = clock;
    this.time = time;
    this.maximumLength = maximumLength;
    this.historySize = historySize;
    intervalNs = intervalMs * 1_000_000L;
  }

  public Message send(String player, String nickname, int color, String raw) {
    if (raw == null
        || raw.codePointCount(0, raw.length()) > maximumLength
        || raw.codePoints()
            .anyMatch(
                value -> value >= Character.MIN_SURROGATE && value <= Character.MAX_SURROGATE))
      throw invalid();
    String text = raw.replaceAll("[\\p{Cc}\\p{Cf}]", "").strip();
    if (text.isEmpty()) throw invalid();
    long now = time.nanos();
    var previous = lastSent.get(player);
    if (previous != null && now - previous < intervalNs)
      throw new ApiException(429, "RATE_LIMITED", "Wait before sending another message");
    var message =
        new Message(UUID.randomUUID().toString(), player, nickname, text, clock.instant(), color);
    lastSent.put(player, now);
    messages.add(message);
    while (messages.size() > historySize) messages.removeFirst();
    return message;
  }

  public List<Message> history() {
    return List.copyOf(messages);
  }

  public void leave(String player) {
    lastSent.remove(player);
  }

  private static ApiException invalid() {
    return new ApiException(
        400, "INVALID_MESSAGE", "Chat must contain plain text within the message limit");
  }
}
