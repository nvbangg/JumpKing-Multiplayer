package jumpking.dto;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import jumpking.exception.ApiException;

public record SoloMetrics(
    @NotNull Long revision,
    @NotNull Status status,
    @NotNull Long playTicks,
    @NotNull Integer jumps,
    @NotNull Integer falls,
    @NotNull Double currentProgress,
    @NotNull Double maxProgress,
    @NotNull Long peakReachedTicks,
    Long finishTicks,
    @NotNull @JsonDeserialize(using = TimestampReader.class) Instant startedAt,
    @JsonDeserialize(using = TimestampReader.class) Instant endedAt) {
  public static class TimestampReader extends JsonDeserializer<Instant> {
    @Override
    public Instant deserialize(JsonParser parser, DeserializationContext context)
        throws java.io.IOException {
      if (!parser.hasToken(JsonToken.VALUE_STRING))
        return (Instant) context.handleUnexpectedToken(Instant.class, parser);
      try {
        return Instant.parse(parser.getText());
      } catch (java.time.format.DateTimeParseException invalid) {
        return (Instant)
            context.handleWeirdStringValue(
                Instant.class, parser.getText(), "Expected an ISO-8601 timestamp");
      }
    }
  }

  public enum Status {
    ACTIVE,
    FINISHED,
    ABANDONED
  }

  public static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

  public SoloMetrics {
    if (currentProgress != null && currentProgress == 0) currentProgress = 0d;
    if (maxProgress != null && maxProgress == 0) maxProgress = 0d;
  }

  public void validate() {
    if (revision < 1
        || revision > MAX_SAFE_INTEGER
        || playTicks < 0
        || playTicks > MAX_SAFE_INTEGER
        || jumps < 0
        || falls < 0
        || !Double.isFinite(currentProgress)
        || !Double.isFinite(maxProgress)
        || currentProgress < 0
        || maxProgress < currentProgress
        || peakReachedTicks < 0
        || peakReachedTicks > playTicks
        || (status == Status.ACTIVE
            ? endedAt != null
            : endedAt == null || endedAt.isBefore(startedAt))
        || (status == Status.FINISHED
            ? finishTicks == null || !finishTicks.equals(playTicks)
            : finishTicks != null)
        || !validTime(startedAt)
        || (endedAt != null && !validTime(endedAt))) {
      throw new ApiException(400, "VALIDATION", "Invalid Solo metrics");
    }
  }

  private static boolean validTime(Instant time) {
    return time.getNano() % 1_000_000 == 0
        && !time.isBefore(Instant.parse("1000-01-01T00:00:00Z"))
        && !time.isAfter(Instant.parse("9999-12-31T23:59:59.999Z"));
  }

  public boolean sameContent(SoloMetrics other) {
    return equals(
        new SoloMetrics(
            revision,
            other.status,
            other.playTicks,
            other.jumps,
            other.falls,
            other.currentProgress,
            other.maxProgress,
            other.peakReachedTicks,
            other.finishTicks,
            other.startedAt,
            other.endedAt));
  }

  public void validateSuccessor(SoloMetrics previous) {
    if (!startedAt.equals(previous.startedAt)
        || (previous.status != Status.ACTIVE && !sameContent(previous))
        || playTicks < previous.playTicks
        || jumps < previous.jumps
        || falls < previous.falls
        || maxProgress < previous.maxProgress
        || peakReachedTicks < previous.peakReachedTicks
        || (maxProgress.equals(previous.maxProgress)
            && !peakReachedTicks.equals(previous.peakReachedTicks))) {
      throw new ApiException(409, "CONFLICT", "Solo metrics conflict with the saved revision");
    }
  }
}
