package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;

class ChatLogTest {
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
            50,
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
    assertThat(chat.history()).hasSize(50);
    assertThat(chat.history().getFirst().text()).isEqualTo("message 1");
    var second = new ChatLog(Clock.systemUTC(), time, 200, 50, 1000);
    assertThat(second.history()).isEmpty();
    chat.leave("a");
    assertThat(chat.send("a", "New membership", 0, "Fresh cooldown").text())
        .isEqualTo("Fresh cooldown");
  }
}
