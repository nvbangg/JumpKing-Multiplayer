package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import jumpking.game.SharedData;
import org.junit.jupiter.api.Test;

class RoomSettingsTest {
  @Test
  void nullableCooldownControlsItemsAndRejectsInvalidMinutes() throws Exception {
    var json = new ObjectMapper();
    var rules = new SharedData(json).rules();
    assertThat(RoomSettings.defaults().itemCooldownMinutes()).isNull();
    for (int minutes : java.util.List.of(1, 3, 10)) {
      var input =
          json.createObjectNode()
              .put("mode", "RACE")
              .putNull("timeLimitMinutes")
              .put("itemCooldownMinutes", minutes);
      var settings = RoomSettings.parse(input, rules);
      assertThat(settings.itemCooldownMinutes()).isEqualTo(minutes);
    }
    var disabled =
        json.createObjectNode()
            .put("mode", "RACE")
            .putNull("timeLimitMinutes")
            .putNull("itemCooldownMinutes");
    assertThat(RoomSettings.parse(disabled, rules).itemCooldownMinutes()).isNull();
    for (String invalid : java.util.List.of("0", "11", "1.5", "true", "\"3\"", "4294967297")) {
      var input = json.createObjectNode().put("mode", "RACE").putNull("timeLimitMinutes");
      input.set("itemCooldownMinutes", json.readTree(invalid));
      assertThatThrownBy(() -> RoomSettings.parse(input, rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
  }

  @Test
  void validatesModesAndWholeMinuteBoundsWithoutCoercion() throws Exception {
    var json = new ObjectMapper();
    var rules = new SharedData(json).rules();
    assertThat(RoomSettings.defaults()).isEqualTo(new RoomSettings("RACE", null, 1, null));
    for (String mode : java.util.List.of("RACE", "EASY", "HARDCORE", "NO_WALK"))
      assertThat(
              RoomSettings.parse(
                  json.readTree("{\"mode\":\"" + mode + "\",\"timeLimitMinutes\":null}"), rules))
          .isEqualTo(new RoomSettings(mode, null, 1, null));
    for (String mode : java.util.List.of("RACE", "EASY", "HARDCORE", "NO_WALK"))
      for (int minutes : java.util.List.of(1, 10))
        assertThat(
                RoomSettings.parse(
                        json.readTree(
                            "{\"mode\":\"" + mode + "\",\"timeLimitMinutes\":" + minutes + "}"),
                        rules)
                    .timeLimitMinutes())
            .isEqualTo(minutes);
    for (int level = 1; level <= 8; level++)
      assertThat(
              RoomSettings.parse(
                      json.readTree(
                          "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"mapId\":" + level + "}"),
                      rules)
                  .mapId())
          .isEqualTo(level);
    for (String level :
        java.util.List.of("0", "10", "1.5", "\"5\"", "null", "true", "4294967297")) {
      assertThatThrownBy(
              () ->
                  RoomSettings.parse(
                      json.readTree(
                          "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"mapId\":" + level + "}"),
                      rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
    for (String input :
        java.util.List.of(
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":0}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":11}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":1.5}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":\"5\"}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":5}",
            "{\"mode\":\"RACE\"}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"extra\":true}",
            "{\"mode\":\"UNKNOWN\",\"timeLimitMinutes\":null}")) {
      assertThatThrownBy(() -> RoomSettings.parse(json.readTree(input), rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
  }
}
