package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import jumpking.game.SharedData;
import org.junit.jupiter.api.Test;

class RoomSettingsTest {
  @Test
  void itemSettingsUseThreeMinutesAndRejectCoercion() throws Exception {
    var json = new ObjectMapper();
    var rules = new SharedData(json).rules();
    assertThat(RoomSettings.defaults().itemsEnabled()).isFalse();
    assertThat(RoomSettings.defaults().itemCooldownMinutes()).isEqualTo(3);
    for (int minutes : java.util.List.of(1, 3, 10)) {
      var input =
          json.createObjectNode()
              .put("mode", "RACE")
              .putNull("timeLimitMinutes")
              .put("itemsEnabled", true)
              .put("itemCooldownMinutes", minutes);
      var settings = RoomSettings.parse(input, rules);
      assertThat(settings.itemsEnabled()).isTrue();
      assertThat(settings.itemCooldownMinutes()).isEqualTo(minutes);
    }
    for (String invalid :
        java.util.List.of("0", "11", "1.5", "null", "true", "\"3\"", "4294967297")) {
      var input = json.createObjectNode().put("mode", "RACE").putNull("timeLimitMinutes");
      input.set("itemCooldownMinutes", json.readTree(invalid));
      assertThatThrownBy(() -> RoomSettings.parse(input, rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
    for (String invalid : java.util.List.of("0", "null", "\"true\"")) {
      var input = json.createObjectNode().put("mode", "RACE").putNull("timeLimitMinutes");
      input.set("itemsEnabled", json.readTree(invalid));
      assertThatThrownBy(() -> RoomSettings.parse(input, rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
  }

  @Test
  void validatesModesAndWholeMinuteBoundsWithoutCoercion() throws Exception {
    var json = new ObjectMapper();
    var rules = new SharedData(json).rules();
    assertThat(RoomSettings.defaults()).isEqualTo(new RoomSettings("RACE", null, 1, false, 3));
    for (String mode : java.util.List.of("RACE", "EASY", "HARDCORE", "NO_WALK"))
      assertThat(
              RoomSettings.parse(
                  json.readTree("{\"mode\":\"" + mode + "\",\"timeLimitMinutes\":null}"), rules))
          .isEqualTo(new RoomSettings(mode, null, 1, false, 3));
    for (int minutes : java.util.List.of(1, 10))
      assertThat(
              RoomSettings.parse(
                      json.readTree(
                          "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":" + minutes + "}"),
                      rules)
                  .timeLimitMinutes())
          .isEqualTo(minutes);
    for (int level = 1; level <= 10; level++)
      assertThat(
              RoomSettings.parse(
                      json.readTree(
                          "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"mapLevel\":"
                              + level
                              + "}"),
                      rules)
                  .mapLevel())
          .isEqualTo(level);
    for (String level :
        java.util.List.of("0", "11", "1.5", "\"5\"", "null", "true", "4294967297")) {
      assertThatThrownBy(
              () ->
                  RoomSettings.parse(
                      json.readTree(
                          "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"mapLevel\":"
                              + level
                              + "}"),
                      rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
    for (String input :
        java.util.List.of(
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":0}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":11}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":1.5}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":\"5\"}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":5}",
            "{\"mode\":\"EASY\",\"timeLimitMinutes\":5}",
            "{\"mode\":\"RACE\"}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"extra\":true}",
            "{\"mode\":\"UNKNOWN\",\"timeLimitMinutes\":null}")) {
      assertThatThrownBy(() -> RoomSettings.parse(json.readTree(input), rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
  }
}
