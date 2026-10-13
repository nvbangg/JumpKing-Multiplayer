package jumpking.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FlightTest {
  private final GameMap world;
  private final Physics physics;

  FlightTest() throws Exception {
    var mapper = new ObjectMapper();
    var data = new SharedData(mapper);
    physics =
        new Physics(
            mapper.convertValue(data.physics(), new TypeReference<Map<String, Number>>() {}));
    var map = mapper.treeToValue(data.map(), GameMap.class);
    var rows = new ArrayList<String>();
    for (int row = 0; row < 45; row++)
      rows.add(((row >= 20 && row <= 25) || row >= 41 ? "#" : " ").repeat(60));
    world =
        new GameMap(
            map.width(),
            map.screenHeight(),
            map.tileSize(),
            map.progressOriginY(),
            map.spawn(),
            map.finish(),
            List.of(new GameMap.Screen(rows, false)));
  }

  @Test
  void gateMovementAndCancel() {
    var denied = new Simulation(world, physics, false, false);
    assertThatThrownBy(() -> denied.setFlight(true)).hasMessageContaining("disabled");
    var sim = new Simulation(world, physics, true, false);
    sim.setFlight(true);
    sim.tick(new PlayerInput(true, false, false, true, false, true));
    assertThat(sim.snapshot().x).isEqualTo(227.5);
    assertThat(sim.snapshot().y).isEqualTo(298.5);
    sim.cancelInput();
    sim.tick(PlayerInput.NEUTRAL);
    assertThat(sim.snapshot().freeFlight).isTrue();
  }

  @Test
  void phasingFallsVerticallyAndRestoresNormalCollision() {
    var sim = new Simulation(world, physics, true, false);
    var saved = sim.snapshot();
    saved.y = 150;
    saved.grounded = false;
    saved.freeFlight = true;
    sim.restore(saved);
    sim.setFlight(false);
    for (int i = 0; i < 120 && sim.snapshot().phasingFall; i++) {
      sim.tick(new PlayerInput(true, false, true));
      assertThat(sim.snapshot().x).isEqualTo(231);
      assertThat(sim.snapshot().jumps).isZero();
    }
    assertThat(sim.snapshot().phasingFall).isFalse();
    assertThat(sim.snapshot().y).isGreaterThanOrEqualTo(208);
    for (int i = 0; i < 100; i++) sim.tick(PlayerInput.NEUTRAL);
    assertThat(sim.snapshot().grounded).isTrue();
  }

  @Test
  void restoreWithoutPermissionAndBottomFallbackPreserveCounters() {
    var sim = new Simulation(world, physics, false, false);
    var saved = sim.snapshot();
    saved.y = 150;
    saved.grounded = false;
    saved.freeFlight = true;
    saved.ticks = 100;
    saved.jumps = 7;
    saved.falls = 2;
    sim.restore(saved);
    assertThat(sim.snapshot().phasingFall).isTrue();
    assertThat(sim.snapshot().freeFlight).isFalse();
    saved.y = 333;
    sim.restore(saved);
    for (int i = 0; i < 30 && sim.snapshot().phasingFall; i++) sim.tick(PlayerInput.NEUTRAL);
    assertThat(sim.snapshot().y).isEqualTo(302);
    assertThat(sim.snapshot().jumps).isEqualTo(7);
    assertThat(sim.snapshot().falls).isEqualTo(2);
    assertThat(sim.snapshot().ticks).isGreaterThan(100);
  }
}
