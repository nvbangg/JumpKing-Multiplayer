package jumpking.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class SharedDataTest {
  @Test
  void sharedDefinitionsAreImmutableAndPlayersKeepIndependentState() throws Exception {
    var data = new SharedData(new ObjectMapper());
    var map = data.roomMap(1);
    assertThatThrownBy(() -> map.screens().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> map.screens().getFirst().tiles().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    var first = new GameSimulation(map, data.tuning(), data.adventure(), false, false);
    var second = new GameSimulation(map, data.tuning(), data.adventure(), false, false);
    var unchanged = second.snapshot();
    var definitions = data.adventure().deepCopy();
    first.tick(new PlayerInput(false, true, false));
    assertThat(second.snapshot()).usingRecursiveComparison().isEqualTo(unchanged);
    assertThat(first.snapshot().physics().ticks).isEqualTo(1);
    assertThat(data.adventure()).isEqualTo(definitions);
  }

  @Test
  void loadsSharedFromClasspathAndProtectsMapResponse() throws Exception {
    var data = new SharedData(new ObjectMapper());
    assertThat(data.map().path("screens").size()).isEqualTo(43);
    assertThat(data.physics().path("chargeTicks").asInt()).isEqualTo(36);
    var copy = (com.fasterxml.jackson.databind.node.ObjectNode) data.map();
    copy.put("width", 0);
    assertThat(data.map().path("width").asInt()).isEqualTo(480);
    for (String field : new String[] {"texture", "font", "sound", "intro", "quotes", "lines"})
      assertThat(data.adventure().toString()).doesNotContain("\"" + field + "\"");
  }
}
