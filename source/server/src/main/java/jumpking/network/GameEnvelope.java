package jumpking.network;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;
import jumpking.exception.ApiException;

public record GameEnvelope(String type, String requestId, JsonNode payload) {
  private static final Set<String> TYPES =
      Set.of(
          "HEARTBEAT",
          "JOIN_COMMUNITY",
          "CREATE_ROOM",
          "JOIN_ROOM",
          "LEAVE_ROOM",
          "GET_ROOM_STATE",
          "UPDATE_ROOM_SETTINGS",
          "START_GAME",
          "GAME_READY",
          "END_MATCH",
          "PLAY_AGAIN",
          "SET_COMMUNITY_PAUSED",
          "CHAT_SEND",
          "PLAYER_INPUT",
          "CANCEL_INPUT",
          "RECONNECT");

  public static GameEnvelope parse(ObjectMapper json, String text) {
    try {
      JsonNode root =
          json.reader()
              .with(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
              .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .readTree(text);
      fields(root, Set.of("v", "type", "requestId", "payload"));
      if (!root.path("v").isIntegralNumber()
          || !root.path("v").canConvertToInt()
          || root.path("v").intValue() != 1
          || !root.path("type").isTextual()
          || !TYPES.contains(root.path("type").textValue())
          || !root.path("payload").isObject()) throw invalid();
      String type = root.path("type").textValue();
      boolean input = type.equals("PLAYER_INPUT") || type.equals("CANCEL_INPUT");
      String id = null;
      if (input) {
        if (root.has("requestId")) throw invalid();
      } else {
        var request = root.path("requestId");
        if (!request.isTextual()
            || request.textValue().isBlank()
            || request.textValue().length() > 64) throw invalid();
        id = request.textValue();
      }
      return new GameEnvelope(type, id, root.get("payload"));
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw invalid();
    }
  }

  public static void fields(JsonNode node, Set<String> allowed) {
    if (node == null || !node.isObject()) throw invalid();
    var names = node.fieldNames();
    while (names.hasNext()) if (!allowed.contains(names.next())) throw invalid();
  }

  public static String text(JsonNode payload, String field) {
    var value = payload.path(field);
    if (!value.isTextual() || value.textValue().isBlank()) throw invalid();
    return value.textValue();
  }

  public static boolean bool(JsonNode payload, String field, boolean optional) {
    if (optional && !payload.has(field)) return false;
    var value = payload.path(field);
    if (!value.isBoolean()) throw invalid();
    return value.booleanValue();
  }

  public static long integer(JsonNode payload, String field) {
    var value = payload.path(field);
    if (!value.isIntegralNumber()
        || !value.canConvertToLong()
        || value.longValue() < 1
        || value.longValue() > 9_007_199_254_740_991L) throw invalid();
    return value.longValue();
  }

  public static ApiException invalid() {
    return new ApiException(400, "INVALID_MESSAGE", "Invalid game message");
  }
}
