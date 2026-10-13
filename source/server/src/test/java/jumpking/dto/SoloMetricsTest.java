package jumpking.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class SoloMetricsTest {
  private SoloMetrics metrics(
      long revision, long ticks, double current, double peak, long peakTicks) {
    return new SoloMetrics(
        revision,
        SoloMetrics.Status.ACTIVE,
        ticks,
        1,
        0,
        current,
        peak,
        peakTicks,
        null,
        Instant.parse("2026-01-01T00:00:00Z"),
        null);
  }

  @Test
  void allowsFallingButKeepsPeakAndFirstPeakTime() {
    var old = metrics(1, 60, 100, 100, 50);
    var falling = metrics(2, 120, 20, 100, 50);
    falling.validate();
    falling.validateSuccessor(old);
    assertThatThrownBy(() -> metrics(2, 120, 20, 100, 90).validateSuccessor(old))
        .hasMessageContaining("conflict");
    assertThatThrownBy(() -> metrics(2, 120, 20, 90, 50).validateSuccessor(old))
        .hasMessageContaining("conflict");
  }

  @Test
  void terminalMetricsCannotBeChangedAndSignedZeroIsCanonical() {
    var ended =
        new SoloMetrics(
            2L,
            SoloMetrics.Status.FINISHED,
            60L,
            1,
            0,
            100d,
            100d,
            50L,
            60L,
            Instant.parse("2026-01-01T00:00:00Z"),
            Instant.parse("2026-01-01T00:00:01Z"));
    ended.validate();
    assertThatThrownBy(() -> metrics(3, 120, 100, 100, 50).validateSuccessor(ended))
        .hasMessageContaining("conflict");
    assertThat(metrics(1, 1, -0d, 0, 0).sameContent(metrics(2, 1, 0, 0, 0))).isTrue();
  }

  @Test
  void rejectsNonfiniteProgressUnsafeIntegersAndSubMillisecondTimes() {
    assertThatThrownBy(() -> metrics(1, 60, Double.NaN, 100, 50).validate())
        .hasMessage("Invalid Solo metrics");
    assertThatThrownBy(() -> metrics(1, SoloMetrics.MAX_SAFE_INTEGER + 1, 10, 100, 50).validate())
        .hasMessage("Invalid Solo metrics");
    var precise =
        new SoloMetrics(
            1L,
            SoloMetrics.Status.ACTIVE,
            0L,
            0,
            0,
            0d,
            0d,
            0L,
            null,
            Instant.parse("2026-01-01T00:00:00.000001Z"),
            null);
    assertThatThrownBy(precise::validate).hasMessage("Invalid Solo metrics");
  }
}
