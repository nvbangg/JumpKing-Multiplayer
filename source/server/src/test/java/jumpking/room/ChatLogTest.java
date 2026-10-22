package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;

class ChatLogTest {
  private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

  @Test
  void unicodeLengthControlCharactersCooldownAndHistoryAreBoundedPerRoom() {
    var now = new AtomicLong();
    var time =
        new MonotonicTime() {
          @Override
          public long nanos() {
            return now.get();
          }
        };
    var chat =
        new ChatLog(
            Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC),
            time,
            200,
            10,
            1000);
    assertThat(chat.send("a", "Alice", 0, "  <b>Hello</b>\u0000\u202e ").text())
        .isEqualTo("<b>Hello</b>");
    assertThatThrownBy(() -> chat.send("a", "Alice", 0, "Again")).isInstanceOf(ApiException.class);
    assertThat(chat.send("b", "Bob", 1, "😀".repeat(200)).text().codePointCount(0, 400))
        .isEqualTo(200);
    assertThatThrownBy(() -> chat.send("b", "Bob", 1, "😀".repeat(201)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> chat.send("c", "C", 2, "\u0000\u202e"))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> chat.send("c", "C", 2, "\ud800")).isInstanceOf(ApiException.class);
    now.set(999_999_999L);
    assertThatThrownBy(() -> chat.send("a", "Alice", 0, "Too soon"))
        .isInstanceOf(ApiException.class);
    now.incrementAndGet();
    assertThat(chat.send("a", "Alice", 0, "Boundary").text()).isEqualTo("Boundary");
    for (int index = 0; index < 51; index++) {
      now.addAndGet(1_000_000_000L);
      chat.send("a", "Alice", 0, "message " + index);
    }
    var history = chat.history("ROOMID", json, 16384).path("messages");
    assertThat(history).hasSize(10);
    assertThat(history.get(0).path("text").asText()).isEqualTo("message 41");
    var second = new ChatLog(Clock.systemUTC(), time, 200, 10, 1000);
    assertThat(second.history("ROOMID", json, 16384).path("messages")).isEmpty();
    chat.leave("a");
    assertThat(chat.send("a", "New membership", 0, "Fresh cooldown").text())
        .isEqualTo("Fresh cooldown");
  }

  @Test
  void historyDropsOnlyTheOldestMessagesToFitTheSerializedUtf8Envelope() throws Exception {
    var chat = new ChatLog(Clock.systemUTC(), new MonotonicTime(), 200, 10, 1);
    for (int index = 0; index < 10; index++)
      chat.send("player" + index, "Player", index, "😀\\\"".repeat(50) + index);
    var full = chat.history("ROOMID", json, 16384);
    assertThat(full.path("messages")).hasSize(10);
    var limited = chat.history("ROOMID", json, 2048);
    var envelope = json.createObjectNode().put("v", 1).put("type", "CHAT_HISTORY");
    envelope.set("payload", limited);
    assertThat(json.writeValueAsBytes(envelope).length).isLessThanOrEqualTo(2048);
    var messages = limited.path("messages");
    assertThat(messages.size()).isBetween(1, 9);
    assertThat(messages.get(messages.size() - 1).path("text").asText()).endsWith("9");
    assertThat(messages.get(0)).isEqualTo(full.path("messages").get(10 - messages.size()));
    assertThat(chat.history("ROOMID", json, 16384)).isEqualTo(full);
  }
}
