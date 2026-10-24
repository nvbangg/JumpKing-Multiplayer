package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;
import jumpking.network.GameEnvelope;

public record RoomSettings(
    String mode,
    Integer timeLimitMinutes,
    int mapLevel,
    boolean itemsEnabled,
    int itemCooldownMinutes) {
  public static final int FULL_MAP_LEVEL = 10;
  private static final Set<String> MODES =
      Set.of("RACE", "EASY", "HARDCORE", "TIME_LIMIT", "NO_WALK");

  public static RoomSettings defaults() {
    return new RoomSettings("RACE", null, 1, false, 3);
  }

  public static RoomSettings parse(JsonNode input, JsonNode rules) {
    GameEnvelope.fields(
        input,
        Set.of("mode", "timeLimitMinutes", "mapLevel", "itemsEnabled", "itemCooldownMinutes"));
    String mode = GameEnvelope.text(input, "mode");
    if (!MODES.contains(mode) || !input.has("timeLimitMinutes")) throw GameEnvelope.invalid();
    Integer minutes = null;
    if (mode.equals("TIME_LIMIT")) {
      var value = input.path("timeLimitMinutes");
      if (!value.isIntegralNumber()
          || !value.canConvertToInt()
          || value.asInt() < rules.path("timeLimitMinutesMin").asInt()
          || value.asInt() > rules.path("timeLimitMinutesMax").asInt())
        throw GameEnvelope.invalid();
      minutes = value.asInt();
    } else if (!input.path("timeLimitMinutes").isNull()) throw GameEnvelope.invalid();
    int level = input.has("mapLevel") ? input.path("mapLevel").asInt(0) : 1;
    if (input.has("mapLevel")
            && (!input.path("mapLevel").isIntegralNumber()
                || !input.path("mapLevel").canConvertToInt())
        || level < 1
        || level > FULL_MAP_LEVEL) throw GameEnvelope.invalid();
    boolean items = GameEnvelope.bool(input, "itemsEnabled", true);
    var cooldown = input.path("itemCooldownMinutes");
    int itemMinutes =
        input.has("itemCooldownMinutes")
            ? cooldown.asInt(0)
            : rules.path("items").path("cooldownDefaultMinutes").asInt();
    if (input.has("itemCooldownMinutes")
            && (!cooldown.isIntegralNumber() || !cooldown.canConvertToInt())
        || itemMinutes < rules.path("items").path("cooldownMinMinutes").asInt()
        || itemMinutes > rules.path("items").path("cooldownMaxMinutes").asInt())
      throw GameEnvelope.invalid();
    return new RoomSettings(mode, minutes, level, items, itemMinutes);
  }
}
