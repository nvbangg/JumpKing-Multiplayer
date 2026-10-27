package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import jumpking.game.*;
import org.junit.jupiter.api.Test;

class RoomItemsTest {
  private final SharedData shared = new SharedData(new ObjectMapper());
  private final Physics p = shared.tuning();

  RoomItemsTest() throws Exception {}

  private Simulation ground(String tile, boolean noWalk) {
    var rows = new ArrayList<>(Collections.nCopies(44, " ".repeat(60)));
    rows.add(tile.repeat(60));
    var map =
        new GameMap(
            480,
            360,
            8,
            352,
            new GameMap.Spawn(100, 326),
            new GameMap.Finish(0, 0, true, 9999, null),
            List.of(new GameMap.Screen(rows, false)));
    var sim = new Simulation(map, p, false, noWalk);
    sim.tick(PlayerInput.NEUTRAL);
    return sim;
  }

  private RoomItems items(String... ids) {
    var items = new RoomItems(p, shared.rules().path("items"), new Random(0));
    items.start(List.of(ids));
    return items;
  }

  @Test
  void oneRandomSlotDoesNotAccumulateAndCooldownBeginsOnlyOnUse() {
    var items = items("a", "b");
    var sim = ground("#", false);
    assertThat(items.slots.get("a").held).isEqualTo(RoomItems.Kind.BANANA);
    items.advance(100_000);
    assertThat(items.slots.get("a").held).isEqualTo(RoomItems.Kind.BANANA);
    items.use("a", sim, Map.of(), 100_000, 3);
    assertThat(items.view("a", 100_000, 0, 360).bananaArmed()).isTrue();
    assertThat(items.view("a", 100_000, 0, 360).cooldownMs()).isZero();
    items.use("a", sim, Map.of(), 100_000, 3);
    assertThat(items.view("a", 100_000, 0, 360).bananaArmed()).isFalse();
    items.use("a", sim, Map.of(), 100_000, 3);
    items.takeoff("a", sim, 100_001, 3);
    assertThat(items.view("a", 100_001, 0, 360).cooldownMs()).isEqualTo(180_000);
    assertThat(items.slots.get("b").held).isNotNull();
    assertThatThrownBy(() -> items.use("a", sim, Map.of(), 100_002, 3))
        .hasMessageContaining("not ready");
    items.advance(110_800);
    assertThat(items.slots.get("a").held).isNull();
    items.advance(110_801);
    assertThat(items.slots.get("a").held).isNotNull();
  }

  @Test
  void bananaSurvivesIndefinitelyButOnlyOnePersonIncludingOwnerCanConsumeIt() {
    var items = items("a");
    var owner = ground("#", false);
    items.use("a", owner, Map.of(), 0, 1);
    items.takeoff("a", owner, 0, 1);
    items.hit(owner, 0);
    assertThat(owner.snapshot().slipping).isFalse();
    var rising = owner.snapshot();
    rising.vy = -1;
    owner.restore(rising);
    items.hit(owner, 1);
    assertThat(owner.snapshot().slipping).isFalse();
    rising.vy = 0;
    owner.restore(rising);
    items.advance(1_000_000);
    items.hit(owner, 1_000_000);
    assertThat(owner.snapshot().slipping).isTrue();
    assertThat(items.view("a", 1_000_000, 0, 360).bananas()).isEmpty();
    var peer = ground("#", false);
    items.hit(peer, 1_000_000);
    assertThat(peer.snapshot().slipping).isFalse();
  }

  @Test
  void bananaLimitIsCheckedWhenPreparingAndAgainAtTakeoffWithoutConsumingTheItem() {
    var rules = shared.rules().path("items").deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode) rules).put("maximumBananas", 1);
    var items = new RoomItems(p, rules, new Random(0));
    items.start(List.of("a", "b"));
    items.slots.get("b").held = RoomItems.Kind.BANANA;
    var first = ground("#", false);
    var second = ground("#", false);
    var pose = second.snapshot();
    pose.x = 200;
    second.restore(pose);
    items.use("a", first, Map.of(), 0, 3);
    items.use("b", second, Map.of(), 0, 3);
    items.takeoff("a", first, 0, 3);
    items.takeoff("b", second, 0, 3);
    var rejected = items.view("b", 0, 0, 360);
    assertThat(rejected.bananas()).hasSize(1);
    assertThat(rejected.held()).isEqualTo(RoomItems.Kind.BANANA);
    assertThat(rejected.bananaArmed()).isFalse();
    assertThat(rejected.cooldownMs()).isZero();
    assertThatThrownBy(() -> items.use("b", second, Map.of(), 1, 3))
        .isInstanceOfSatisfying(
            jumpking.exception.ApiException.class,
            error -> assertThat(error.code()).isEqualTo("ITEM_UNAVAILABLE"));
    items.hit(first, 1);
    items.use("b", second, Map.of(), 2, 3);
    items.takeoff("b", second, 2, 3);
    assertThat(items.view("b", 2, 0, 360).bananas()).hasSize(1);
    assertThat(items.slots.get("b").held).isNull();
  }

  @Test
  void rockTargetsActualHighestOtherPlayerAndNeverStacksVelocity() {
    var items = items("a", "b");
    items.slots.get("a").held = RoomItems.Kind.ROCK;
    var own = ground("#", false);
    var low = ground("#", false);
    var high = ground("#", false);
    var pose = high.snapshot();
    pose.x = 200;
    pose.y = 100;
    pose.grounded = false;
    pose.vy = -8;
    high.restore(pose);
    var targets = new LinkedHashMap<String, Simulation>();
    targets.put("a", own);
    targets.put("low", low);
    targets.put("high", high);
    items.use("a", own, targets, 0, 3);
    assertThat(high.snapshot().slipping).isTrue();
    assertThat(high.snapshot().vy).isZero();
    assertThat(high.snapshot().vx).isEqualTo(6);
    assertThat(low.snapshot().slipping).isFalse();
    items.slots.get("b").held = RoomItems.Kind.ROCK;
    items.use("b", own, targets, 1, 3);
    assertThat(high.snapshot().vx).isEqualTo(6);
    high.tick(PlayerInput.NEUTRAL);
    assertThat(high.snapshot().vy).isGreaterThan(0);
    items.clear();
    assertThat(items.view("a", 10, 0, 360).rocks()).isEmpty();
  }

  @Test
  void invalidUseDoesNotLoseItemOrStartCooldown() {
    var items = items("a");
    var own = ground("#", false);
    var pose = own.snapshot();
    pose.grounded = false;
    own.restore(pose);
    assertThatThrownBy(() -> items.use("a", own, Map.of(), 0, 3))
        .hasMessageContaining("Stand on the ground");
    assertThat(items.slots.get("a").held).isEqualTo(RoomItems.Kind.BANANA);
    items.slots.get("a").held = RoomItems.Kind.ROCK;
    assertThatThrownBy(() -> items.use("a", own, Map.of("a", own), 0, 3))
        .hasMessageContaining("No other player");
    assertThat(items.view("a", 0, 0, 360).cooldownMs()).isZero();
    assertThat(items.slots.get("a").held).isEqualTo(RoomItems.Kind.ROCK);
  }

  @Test
  void bootsActivateOneBoostAndStartCooldownWithoutStacking() {
    var items = items("a");
    var own = ground("#", false);
    items.slots.get("a").held = RoomItems.Kind.BOOTS;
    items.use("a", own, Map.of(), 100, 3);
    assertThat(own.snapshot().jumpBoost).isTrue();
    assertThat(items.view("a", 100, 0, 360).held()).isNull();
    assertThat(items.view("a", 100, 0, 360).cooldownMs()).isEqualTo(180_000);
    items.slots.get("a").held = RoomItems.Kind.BOOTS;
    assertThatThrownBy(() -> items.use("a", own, Map.of(), 101, 3))
        .hasMessageContaining("already active");
    assertThat(items.slots.get("a").held).isEqualTo(RoomItems.Kind.BOOTS);
    for (int i = 0; i < p.chargeTicks; i++) own.tick(new PlayerInput(false, true, true));
    assertThat(own.snapshot().vy).isEqualTo((double) (float) (p.jumpVelocity * Math.sqrt(2)));
    assertThat(own.snapshot().vx).isEqualTo(p.jumpSpeed);
    assertThat(own.snapshot().jumpBoost).isFalse();
  }

  @Test
  void bootsSurviveCanceledChargeSnowAndRespawnUntilARealJump() {
    var sim = ground("N", false);
    sim.boostJump();
    for (int i = 0; i < 4; i++) sim.tick(new PlayerInput(false, false, true));
    sim.cancelInput();
    sim.tick(PlayerInput.NEUTRAL);
    for (int i = 0; i < 4; i++) sim.tick(new PlayerInput(false, false, true));
    sim.tick(PlayerInput.NEUTRAL);
    assertThat(sim.snapshot().jumps).isZero();
    assertThat(sim.snapshot().jumpBoost).isTrue();
    var restored = ground("N", false);
    restored.restore(sim.snapshot());
    restored.respawnAt(100, 326);
    assertThat(restored.snapshot().jumpBoost).isTrue();
    for (int i = 0; i < 5; i++) restored.tick(PlayerInput.NEUTRAL);
    for (int i = 0; i < p.chargeTicks; i++) restored.tick(new PlayerInput(false, false, true));
    assertThat(restored.snapshot().jumps).isEqualTo(1);
    assertThat(restored.snapshot().jumpBoost).isFalse();
    assertThat(ground("N", false).snapshot().jumpBoost).isFalse();
  }

  @Test
  void slipHasNoIceFrictionAndStopsAtWorldBoundaryInBothWalkingModes() {
    for (boolean noWalk : List.of(false, true)) {
      var sim = ground("I", noWalk);
      sim.slip(1, false);
      for (int i = 0; i < 20; i++) sim.tick(new PlayerInput(true, false, true));
      assertThat(sim.snapshot().x).isEqualTo(220);
      assertThat(sim.snapshot().vx).isEqualTo(6);
      assertThat(sim.snapshot().charge).isZero();
      assertThat(sim.snapshot().jumps).isZero();
      var restored = ground("I", noWalk);
      restored.restore(sim.snapshot());
      for (int i = 0; i < 60; i++) {
        sim.tick(PlayerInput.NEUTRAL);
        restored.tick(PlayerInput.NEUTRAL);
      }
      assertThat(sim.snapshot().x).isEqualTo(471);
      assertThat(sim.snapshot().vx).isZero();
      assertThat(sim.snapshot().slipping).isFalse();
      assertThat(restored.snapshot()).usingRecursiveComparison().isEqualTo(sim.snapshot());
    }
  }
}
