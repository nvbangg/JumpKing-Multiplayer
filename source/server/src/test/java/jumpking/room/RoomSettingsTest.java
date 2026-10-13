package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import jumpking.game.SharedData;
import org.junit.jupiter.api.Test;

class RoomSettingsTest {
  @Test
  void validatesTheFourModesAndWholeMinuteBoundsWithoutCoercion() throws Exception {
    var json = new ObjectMapper();
    var rules = new SharedData(json).rules();
    assertThat(RoomSettings.defaults()).isEqualTo(new RoomSettings("RACE", null, 10));
    for (String mode : java.util.List.of("RACE", "HARDCORE", "NO_WALK"))
      assertThat(
              RoomSettings.parse(
                  json.readTree("{\"mode\":\"" + mode + "\",\"timeLimitMinutes\":null}"), rules))
          .isEqualTo(new RoomSettings(mode, null, 10));
    for (int minutes : java.util.List.of(1, 30))
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
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":31}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":1.5}",
            "{\"mode\":\"TIME_LIMIT\",\"timeLimitMinutes\":\"5\"}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":5}",
            "{\"mode\":\"RACE\"}",
            "{\"mode\":\"RACE\",\"timeLimitMinutes\":null,\"extra\":true}",
            "{\"mode\":\"UNKNOWN\",\"timeLimitMinutes\":null}")) {
      assertThatThrownBy(() -> RoomSettings.parse(json.readTree(input), rules))
          .isInstanceOf(jumpking.exception.ApiException.class);
    }
  }
}
