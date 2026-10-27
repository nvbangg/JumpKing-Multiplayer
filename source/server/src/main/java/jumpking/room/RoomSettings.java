package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;
import jumpking.network.GameEnvelope;

public record RoomSettings(
    String mode, Integer timeLimitMinutes, int mapId, Integer itemCooldownMinutes) {
  public static final int FINAL_MAP_ID = 9;
  public static final Set<String> MODES = Set.of("RACE", "EASY", "HARDCORE", "NO_WALK");

  public static RoomSettings defaults() {
    return new RoomSettings("RACE", null, 1, null);
  }

  public static RoomSettings parse(JsonNode input, JsonNode rules) {
    GameEnvelope.fields(input, Set.of("mode", "timeLimitMinutes", "mapId", "itemCooldownMinutes"));
    String mode = GameEnvelope.text(input, "mode");
    if (!MODES.contains(mode) || !input.has("timeLimitMinutes")) throw GameEnvelope.invalid();
    Integer minutes = null;
    var value = input.path("timeLimitMinutes");
    if (!value.isNull()) {
      if (!value.isIntegralNumber()
          || !value.canConvertToInt()
          || value.asInt() < rules.path("timeLimitMinutesMin").asInt()
          || value.asInt() > rules.path("timeLimitMinutesMax").asInt())
        throw GameEnvelope.invalid();
      minutes = value.asInt();
    }
    int mapId = input.has("mapId") ? input.path("mapId").asInt(0) : 1;
    if (input.has("mapId")
            && (!input.path("mapId").isIntegralNumber() || !input.path("mapId").canConvertToInt())
        || mapId < 1
        || mapId > FINAL_MAP_ID) throw GameEnvelope.invalid();
    Integer itemMinutes = null;
    var cooldown = input.path("itemCooldownMinutes");
    if (input.has("itemCooldownMinutes") && !cooldown.isNull()) {
      if (!cooldown.isIntegralNumber()
          || !cooldown.canConvertToInt()
          || cooldown.asInt() < rules.path("items").path("cooldownMinMinutes").asInt()
          || cooldown.asInt() > rules.path("items").path("cooldownMaxMinutes").asInt())
        throw GameEnvelope.invalid();
      itemMinutes = cooldown.asInt();
    }
    return new RoomSettings(mode, minutes, mapId, itemMinutes);
  }
}
