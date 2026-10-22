package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import jumpking.config.NetworkSettings;
import jumpking.game.*;
import jumpking.network.GameEnvelope;
import jumpking.support.MainBabeRoute;
import org.junit.jupiter.api.Test;

class RoomMatchTest {
  private final ObjectMapper json = new ObjectMapper();
  private final SharedData shared;

  RoomMatchTest() throws Exception {
    shared = new SharedData(json);
  }

  private RoomMatch match() {
    return match(RoomSettings.defaults());
  }

  private RoomMatch match(RoomSettings settings) {
    var limits =
        new NetworkSettings(
            30, 2, 32, 256, 64, 20, 16_384, 120, 120, 64, 240, 4, 8, 5000, 30000, 500, 60, 200, 50,
            1000);
    return new RoomMatch(
        "ABCDEF",
        settings,
        List.of(
            new RoomMatch.Spec("first", 1, "First", 0, 1),
            new RoomMatch.Spec("second", 2, "Second", 1, 1)),
        shared,
        limits,
        false);
  }

  private void place(RoomMatch.Player player, int x, int y, double vy, boolean grounded) {
    var state = player.game.physics().snapshot();
    state.x = x;
    state.y = y;
    state.vx = 0;
    state.vy = vy;
    state.grounded = grounded;
    state.splat = 0;
    state.phasingFall = false;
    player.game.physics().restore(state);
  }

  @Test
  void preparedBananaDropsOnlyOnJumpInEveryMode() {
    for (var mode : List.of("RACE", "HARDCORE", "TIME_LIMIT", "NO_WALK")) {
      var match = match(new RoomSettings(mode, mode.equals("TIME_LIMIT") ? 5 : null, 10, true, 3));
      var now = Instant.parse("2026-01-01T00:00:00Z");
      match.start(now);
      for (int i = 0; i < 30; i++) match.tick(1, now);
      var first = match.players.get("first");
      match.items.slots.get("first").held = RoomItems.Kind.BANANA;
      match.useItem("first", java.util.Set.of("first", "second"));
      assertThat(match.items.view("first", match.ticks, 0, 360).bananas()).isEmpty();
      first.input.offer(
          new GameEnvelope(
              "PLAYER_INPUT",
              null,
              json.valueToTree(
                  java.util.Map.of(
                      "playId",
                      match.id,
                      "generation",
                      1,
                      "seq",
                      1,
                      "left",
                      false,
                      "right",
                      false,
                      "jump",
                      true))),
          1,
          false);
      for (int i = 0; i < 10; i++) match.tick(1, now);
      first.input.offer(
          new GameEnvelope(
              "PLAYER_INPUT",
              null,
              json.valueToTree(
                  java.util.Map.of(
                      "playId",
                      match.id,
                      "generation",
                      1,
                      "seq",
                      2,
                      "left",
                      false,
                      "right",
                      false,
                      "jump",
                      false))),
          1,
          false);
      match.tick(1, now);
      assertThat(first.game.physics().snapshot().jumps).isEqualTo(1);
      assertThat(match.items.view("first", match.ticks, 0, 360).bananas()).hasSize(1);
      assertThat(match.items.view("first", match.ticks, 0, 360).held()).isNull();
      match.tick(1, now);
      assertThat(first.game.physics().snapshot().slipping).isFalse();
      assertThat(match.players.get("second").game.physics().snapshot().slipping).isTrue();
      assertThat(match.players.get("second").game.physics().snapshot().falls).isZero();
      first.game.physics().respawn();
      assertThat(match.items.view("first", match.ticks, 0, 360).cooldownMs()).isGreaterThan(0);
      match.finish("HOST_ENDED", now);
      assertThat(match.items.view("first", match.ticks, 0, 360).bananas()).isEmpty();
    }
  }

  @Test
  void eachWinnerKeepsTheirOwnRavenEndingAndANewMatchResetsProgress() throws Exception {
    var match = match();
    var now = Instant.parse("2026-01-01T00:00:00Z");
    match.start(now);
    var point = landing(10);
    match.ticks = point.ticks;
    for (var player : match.players.values()) player.game.physics().restore(point);
    var first = match.players.get("first");
    var saved = first.game.adventure().snapshot();
    var raven = (com.fasterxml.jackson.databind.node.ObjectNode) saved.path("raven");
    var perch = shared.adventure().path("raven").path("positions").get(13);
    raven
        .put("index", 13)
        .put("done", true)
        .put("x", perch.path("x").asDouble())
        .put("y", perch.path("y").asDouble() - perch.path("screen").asInt() * 360);
    first.game.adventure().restore(saved);
    match.tick(1_000_000_000L, now);
    assertThat(first.ending).containsEntry("ravenDone", true);
    assertThat(match.players.get("second").ending).containsEntry("ravenDone", false);
    assertThat(match().players.get("first").game.adventure().ravenDone()).isFalse();
  }

  @Test
  void currentProgressOnlyChangesOnValidLandingsWhilePeakTracksAirborneHeight() {
    var match = match();
    var start = Instant.parse("2026-01-01T00:00:00Z");
    var player = match.players.get("first");
    assertThat(player.currentProgress).isZero();
    match.start(start);
    place(player, 77, 158, shared.tuning().gravity, true);
    match.tick(1_000_000_000L, start);
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(player.maximum).isEqualTo(144);
    assertThat(player.peak).isEqualTo(1);

    place(player, 231, 110, -5, false);
    match.tick(1_000_000_000L, start);
    assertThat(player.game.physics().progress()).isEqualTo(197);
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(player.maximum).isEqualTo(197);
    assertThat(player.peak).isEqualTo(2);

    place(player, 231, 220, 2, false);
    match.tick(1_000_000_000L, start);
    assertThat(player.game.physics().progress()).isEqualTo(80);
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(player.maximum).isEqualTo(197);
    assertThat(player.peak).isEqualTo(2);

    place(player, 231, 302, shared.tuning().gravity, true);
    match.tick(1_000_000_000L, start);
    assertThat(player.currentProgress).isZero();
    assertThat(player.maximum).isEqualTo(197);
    assertThat(player.peak).isEqualTo(2);
  }

  @Test
  void splatAndPhasingFallKeepTheLastLandingUntilSplatRecovery() {
    var match = match();
    var start = Instant.parse("2026-01-01T00:00:00Z");
    var player = match.players.get("first");
    match.start(start);
    place(player, 77, 158, shared.tuning().gravity, true);
    var state = player.game.physics().snapshot();
    state.splat = 2;
    player.game.physics().restore(state);
    match.tick(1_000_000_000L, start);
    assertThat(player.game.physics().snapshot().splat).isEqualTo(1);
    assertThat(player.currentProgress).isZero();
    assertThat(player.maximum).isEqualTo(144);

    player.input.offer(
        new GameEnvelope(
            "PLAYER_INPUT",
            null,
            json.createObjectNode()
                .put("playId", match.id)
                .put("generation", player.spec.generation())
                .put("seq", 1)
                .put("left", false)
                .put("right", false)
                .put("jump", true)),
        1_000_000_000L,
        false);
    match.tick(1_000_000_000L, start);
    assertThat(player.game.physics().snapshot().splat).isZero();
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(player.peak).isEqualTo(1);

    place(player, 200, 50, 0, true);
    state = player.game.physics().snapshot();
    state.phasingFall = true;
    player.game.physics().restore(state);
    match.tick(1_000_000_000L, start);
    assertThat(player.game.physics().snapshot().phasingFall).isTrue();
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(player.maximum).isGreaterThan(250);
    assertThat(player.peak).isEqualTo(3);
  }

  @Test
  void standingsWritesAndResultsUseTheFrozenLandingProgressForDnf() {
    var match = match();
    var start = Instant.parse("2026-01-01T00:00:00Z");
    var player = match.players.get("first");
    match.start(start);
    place(player, 77, 158, shared.tuning().gravity, true);
    match.tick(1_000_000_000L, start);
    place(player, 231, 110, -5, false);
    match.tick(1_000_000_000L, start);
    match.abandon("first", start.plusSeconds(1));
    match.tick(2_000_000_000L, start.plusSeconds(1));
    assertThat(player.game.physics().snapshot().ticks).isEqualTo(2);
    assertThat(player.currentProgress).isEqualTo(144);
    assertThat(match.standings(java.util.Set.of("first", "second")))
        .extracting(jumpking.dto.PlayerStanding::currentProgress)
        .containsExactly(144.0, 0.0);
    match.finish("HOST_ENDED", start.plusSeconds(2));
    assertThat(player.rank).isEqualTo(1);
    var write = match.write(1).runs().getFirst();
    assertThat(write.status()).isEqualTo("DNF");
    assertThat(write.progress()).isEqualTo(144);
    assertThat(write.maximum()).isEqualTo(197);
    assertThat(write.peak()).isEqualTo(2);
    var result = json.valueToTree(match.results()).path("results").get(0);
    assertThat(result.path("currentProgress").asDouble()).isEqualTo(144);
    assertThat(result.path("maxProgress").asDouble()).isEqualTo(197);
  }

  @Test
  void hardcoreSplatRespawnsCurrentProgressWithoutResettingPeakOrCounters() {
    var match = match(new RoomSettings("HARDCORE", null, RoomSettings.FULL_MAP_LEVEL, false, 3));
    var start = Instant.parse("2026-01-01T00:00:00Z");
    var player = match.players.get("first");
    match.start(start);
    place(player, 77, 158, shared.tuning().gravity, true);
    match.tick(1_000_000_000L, start);
    place(player, 231, 110, -5, false);
    match.tick(1_000_000_000L, start);
    place(player, 231, 300, shared.tuning().maxFall, false);
    var events = match.tick(1_000_000_000L, start);
    assertThat(events.getFirst().effects().movement()).contains("SPLAT");
    assertThat(player.currentProgress).isZero();
    assertThat(player.maximum).isEqualTo(197);
    assertThat(player.peak).isEqualTo(2);
    var state = player.game.physics().snapshot();
    assertThat(state.y).isEqualTo(302);
    assertThat(state.ticks).isEqualTo(3);
    assertThat(state.falls).isEqualTo(1);
  }

  @Test
  void everyLengthFinalizesOnItsOwnLandingAndOnlyFullMapOffersAnEnding() throws Exception {
    for (var goal : shared.roomMaps()) {
      var point = landing(goal.level());
      var match = match(new RoomSettings("RACE", null, goal.level(), false, 3));
      var now = Instant.parse("2026-01-01T00:00:00Z");
      match.start(now);
      for (var player : match.players.values()) player.game.physics().restore(point);
      match.ticks = point.ticks;
      match.tick(1_000_000_000L, now.plusSeconds(300));
      assertThat(match.reason).as("map %s", goal.level()).isEqualTo("FINISH");
      assertThat(match.results().get("mapLevel")).isEqualTo(goal.level());
      for (var player : match.players.values())
        assertThat(player.ending != null).isEqualTo(goal.level() == 10);
    }
  }

  @Test
  void roomClockAndDisconnectedPhysicsAreAuthoritativeWhileDnfMetricsFreeze() {
    var match = match();
    var start = Instant.parse("2026-01-01T00:00:00Z");
    match.start(start);
    for (int index = 0; index < 4; index++) match.tick(1_000_000_000L, start);
    match.abandon("second", start.plusSeconds(1));
    for (int index = 0; index < 3; index++) match.tick(2_000_000_000L, start.plusSeconds(1));
    assertThat(match.ticks).isEqualTo(7);
    assertThat(match.players.get("second").game.physics().snapshot().ticks).isEqualTo(4);
    match.finish("HOST_ENDED", start.plusSeconds(2));
    assertThat(match.players.get("first").status).isEqualTo("UNFINISHED");
    assertThat(match.players.values()).noneMatch(player -> player.winner);
    var write = match.write(1);
    assertThat(write.duration()).isEqualTo(7);
    assertThat(write.runs().get(1).status()).isEqualTo("DNF");
    assertThat(write.runs().get(1).endedAt()).isEqualTo(start.plusSeconds(1));
    match.tick(3_000_000_000L, start.plusSeconds(3));
    assertThat(match.ticks).isEqualTo(7);
  }

  @Test
  void liveStandingsKeepTiesAndExcludeMembersWhoHaveLeft() {
    var match = match();
    var everyone = match.standings(java.util.Set.of("first", "second"));
    assertThat(everyone).extracting(jumpking.dto.PlayerStanding::rank).containsExactly(1, 1);
    assertThat(match.standings(java.util.Set.of("first")))
        .extracting(jumpking.dto.PlayerStanding::playerId)
        .containsExactly("first");
    assertThat(match.standings(java.util.Set.of())).isEmpty();
  }

  @Test
  void allPlayersOfTheFinishingTickAreProcessedBeforeResultsAndTies() throws Exception {
    var match = match();
    var before = MainBabeRoute.beforeFinish(shared, json);
    var start = Instant.parse("2026-01-01T00:00:00Z");
    match.start(start);
    match.ticks = before.physics().ticks;
    for (var player : match.players.values()) {
      player.game.restore(before);
      player.maximum = player.game.physics().progress();
      player.peak = before.physics().ticks;
    }
    match.tick(1_000_000_000L, start.plusSeconds(283));
    assertThat(match.ticks).isEqualTo(16957);
    assertThat(match.reason).isEqualTo("FINISH");
    assertThat(match.players.values())
        .allMatch(player -> player.winner && player.rank == 1 && player.finish == 16957);
    assertThat(match.write(1).runs())
        .allMatch(
            run -> run.status().equals("FINISHED") && run.ticks() == 16957 && run.rank() == 1);
  }

  private PlayerState landing(int level) throws Exception {
    var sim = new Simulation(shared.roomMap(level), shared.tuning(), false, false);
    try (var input =
        new org.springframework.core.io.ClassPathResource("fixtures/main-babe-checkpoints.json")
            .getInputStream()) {
      for (var checkpoint : json.readTree(input)) {
        sim.restore(json.treeToValue(checkpoint, PlayerState.class));
        if (level == 6 && sim.snapshot().ticks == 9469)
          for (int tick = 0; tick < 4; tick++) sim.tick(new PlayerInput(false, true, false));
        if (sim.finished()) return sim.snapshot();
      }
    }
    throw new IllegalArgumentException("Missing Finish landing for map " + level);
  }
}
