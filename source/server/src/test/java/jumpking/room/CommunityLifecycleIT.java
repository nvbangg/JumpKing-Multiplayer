package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import jumpking.JumpKingApplication;
import jumpking.game.*;
import jumpking.network.SerialExecutor;
import jumpking.service.CommunityRuns;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

@SpringBootTest(
    classes = {JumpKingApplication.class, CommunityLifecycleIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.allowed-origins=http://allowed.test")
class CommunityLifecycleIT {
  static class TestTime extends MonotonicTime {
    final AtomicLong value = new AtomicLong(1_000_000_000L);

    @Override
    public long nanos() {
      return value.get();
    }

    void advance(long ms) {
      value.addAndGet(TimeUnit.MILLISECONDS.toNanos(ms));
    }
  }

  @Test
  void staleContinueReturnsConflictWithoutLeavingOrClosingTheConnection() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var missing = new java.util.HashMap<String, Object>();
      missing.put("newRun", false);
      missing.put("expectedRunId", java.util.UUID.randomUUID().toString());
      int before = client.messages.size();
      var rejected = client.command("JOIN_COMMUNITY", missing);
      assertThat(rejected.path("type").asText()).isEqualTo("ERROR");
      assertThat(rejected.path("payload").path("code").asText()).isEqualTo("CONFLICT");
      assertThat(client.messages.subList(before, client.messages.size()))
          .noneMatch(message -> message.path("type").asText().equals("ROOM_LEFT"));
      assertThat(client.request("/community/current", "GET", null).path("run").isNull()).isTrue();
      client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @TestConfiguration
  static class TimeConfiguration {
    @Bean
    @Primary
    TestTime testTime() {
      return new TestTime();
    }
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired TestTime time;
  @Autowired Memberships memberships;
  @Autowired Community server;
  @Autowired CommunityRuns records;
  @Autowired SharedData shared;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  private void step(GameClient client, long milliseconds) throws Exception {
    long before = client.snapshot().path("serverTick").asLong();
    time.advance(milliseconds);
    client.await(
        message ->
            message.path("type").asText().equals("GAME_SNAPSHOT")
                && message.path("payload").path("serverTick").asLong() > before);
  }

  private void idle(GameClient client, long milliseconds) throws Exception {
    var membership = memberships.find(client.owner);
    Object tower =
        ((Map<?, ?>) ReflectionTestUtils.getField(server, "towers")).get(membership.roomId());
    var checked = new CompletableFuture<Void>();
    ((SerialExecutor) ReflectionTestUtils.getField(tower, "actor"))
        .execute(
            () -> {
              try {
                long before = (Long) ReflectionTestUtils.getField(tower, "serverTick");
                time.advance(milliseconds);
                ReflectionTestUtils.invokeMethod(tower, "advance");
                assertThat(ReflectionTestUtils.getField(tower, "serverTick")).isEqualTo(before);
                checked.complete(null);
              } catch (Throwable error) {
                checked.completeExceptionally(error);
              }
            });
    checked.get(8, TimeUnit.SECONDS);
  }

  private JsonNode tickAt(
      GameClient client, double x, double y, boolean grounded, int splat, boolean phasingFall)
      throws Exception {
    var membership = memberships.find(client.owner);
    Object tower =
        ((Map<?, ?>) ReflectionTestUtils.getField(server, "towers")).get(membership.roomId());
    var result = new CompletableFuture<Long>();
    ((SerialExecutor) ReflectionTestUtils.getField(tower, "actor"))
        .execute(
            () -> {
              try {
                Object player =
                    ((Map<?, ?>) ReflectionTestUtils.getField(tower, "players"))
                        .get(membership.playerId());
                var game = (GameSimulation) ReflectionTestUtils.getField(player, "game");
                var snapshot = game.snapshot();
                var pose = snapshot.physics();
                pose.x = x;
                pose.y = y;
                pose.vx = 0;
                pose.vy = shared.tuning().gravity;
                pose.grounded = grounded;
                pose.splat = splat;
                pose.phasingFall = phasingFall;
                game.restore(snapshot);
                ReflectionTestUtils.invokeMethod(tower, "tick", time.nanos());
                ReflectionTestUtils.invokeMethod(server, "snapshots", tower);
                result.complete((Long) ReflectionTestUtils.getField(tower, "serverTick"));
              } catch (Throwable error) {
                result.completeExceptionally(error);
              }
            });
    long tick = result.get(8, TimeUnit.SECONDS);
    return client
        .await(
            message ->
                message.path("type").asText().equals("GAME_SNAPSHOT")
                    && message.path("payload").path("serverTick").asLong() == tick)
        .path("payload");
  }

  private void assertCurrentProgress(GameClient client, JsonNode snapshot, double expected) {
    assertThat(snapshot.path("self").path("metrics").path("currentProgress").asDouble())
        .isEqualTo(expected);
    String id = memberships.find(client.owner).playerId();
    for (var player : snapshot.path("players"))
      if (player.path("playerId").asText().equals(id)) {
        assertThat(player.path("currentProgress").asDouble()).isEqualTo(expected);
        return;
      }
    fail("Player standing is missing");
  }

  @Test
  void currentProgressChangesOnlyOnValidLandingWhilePeakKeepsAirborneHeight() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var joined = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      assertCurrentProgress(client, tickAt(client, 77, 158, true, 0, false), 144);
      var airborne = tickAt(client, 200, 50, false, 0, false);
      assertCurrentProgress(client, airborne, 144);
      assertThat(
              airborne.path("self").path("simulation").path("physics").path("grounded").asBoolean())
          .isFalse();
      double maximum = airborne.path("self").path("metrics").path("maxProgress").asDouble();
      assertThat(maximum).isGreaterThan(144);
      var splatted = tickAt(client, 231, 302, true, 3, false);
      assertCurrentProgress(client, splatted, 144);
      assertThat(splatted.path("self").path("simulation").path("physics").path("splat").asInt())
          .isPositive();
      var phasing = tickAt(client, 231, 328, true, 0, true);
      assertCurrentProgress(client, phasing, 144);
      assertThat(
              phasing
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("phasingFall")
                  .asBoolean())
          .isTrue();
      var lowerLanding = tickAt(client, 231, 302, true, 0, false);
      assertCurrentProgress(client, lowerLanding, 0);
      assertThat(lowerLanding.path("self").path("metrics").path("maxProgress").asDouble())
          .isEqualTo(maximum);
      client.ok("LEAVE_ROOM", Map.of());
      var current = client.request("/community/current", "GET", null).path("run");
      assertThat(current.path("id").asText()).isEqualTo(joined.path("playId").asText());
      assertThat(current.path("currentProgress").asDouble()).isZero();
      assertThat(current.path("maxProgress").asDouble()).isEqualTo(maximum);
    }
  }

  @Test
  void inputBacklogResyncKeepsCommunityRunAndDoesNotReleaseJump() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var join = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      String play = join.path("playId").asText();
      for (int seq = 1; seq <= 40; seq++)
        client.input(
            Map.of(
                "playId",
                play,
                "generation",
                1,
                "seq",
                seq,
                "left",
                false,
                "right",
                false,
                "jump",
                true));
      client.ok("GET_ROOM_STATE", Map.of());
      step(client, 499);
      client.input(
          Map.of(
              "playId",
              play,
              "generation",
              1,
              "seq",
              41,
              "left",
              false,
              "right",
              false,
              "jump",
              false));
      client.ok("GET_ROOM_STATE", Map.of());
      time.advance(1);
      GameClient.until(client.socket::isInputClosed);
      client.connect();
      var context =
          client.ok(
              "RECONNECT",
              Map.of(
                  "roomId",
                  join.path("roomId").asText(),
                  "playerId",
                  join.path("playerId").asText(),
                  "reconnectToken",
                  join.path("reconnectToken").asText()));
      assertThat(context.path("generation").asInt()).isEqualTo(2);
      assertThat(context.path("playId").asText()).isEqualTo(play);
      var state =
          client
              .await(
                  message ->
                      message.path("type").asText().equals("GAME_SNAPSHOT")
                          && message.path("payload").path("generation").asInt() == 2)
              .path("payload");
      assertThat(state.path("self").path("paused").asBoolean()).isTrue();
      assertThat(state.path("self").path("simulation").path("physics").path("jumps").asInt())
          .isZero();
      assertThat(state.path("self").path("simulation").path("physics").path("charge").asInt())
          .isZero();
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void disabledFlightAndClientPositionsCannotChangeAuthoritativeState() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var join = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      client.input(
          Map.of(
              "playId",
              join.path("playId").asText(),
              "generation",
              1,
              "seq",
              1,
              "left",
              false,
              "right",
              false,
              "jump",
              false,
              "freeFlight",
              true));
      client.await(
          message ->
              message.path("type").asText().equals("ERROR")
                  && message.path("payload").path("code").asText().equals("INVALID_INPUT"));
      client.input(
          Map.of(
              "playId",
              join.path("playId").asText(),
              "generation",
              1,
              "seq",
              2,
              "left",
              false,
              "right",
              false,
              "jump",
              false,
              "y",
              -15018));
      client.await(
          message ->
              message.path("type").asText().equals("ERROR")
                  && message.path("payload").path("code").asText().equals("INVALID_MESSAGE"));
      step(client, 100);
      var physics = client.snapshot().path("self").path("simulation").path("physics");
      client.messages.removeIf(message -> message.path("type").asText().equals("ERROR"));
      client
          .socket
          .sendText(
              json.writeValueAsString(
                  Map.of(
                      "v",
                      1,
                      "type",
                      "EQUIP_ITEM",
                      "requestId",
                      "removed-api",
                      "payload",
                      Map.of("itemId", "Cap", "equipped", true))),
              true)
          .join();
      client.await(
          message ->
              message.path("type").asText().equals("ERROR")
                  && message.path("payload").path("code").asText().equals("INVALID_MESSAGE"));
      assertThat(
              client.snapshot().path("self").path("simulation").path("adventure").has("equipped"))
          .isFalse();
      assertThat(physics.path("freeFlight").asBoolean()).isFalse();
      assertThat(physics.path("screen").asInt()).isZero();
      assertThat(physics.path("jumps").asInt()).isZero();
      assertThat(client.snapshot().path("self").path("status").asText()).isEqualTo("ACTIVE");
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void neutralFramesDoNotResetAfkAndPausedSlotExpiresExactlyAtFifteenMinutes() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var join = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      step(client, 29_999);
      client.ok("CHAT_SEND", Map.of("text", "Chat does not count as a movement input"));
      client.input(
          Map.of(
              "playId",
              join.path("playId").asText(),
              "generation",
              1,
              "seq",
              1,
              "left",
              false,
              "right",
              false,
              "jump",
              false));
      client.ok("GET_ROOM_STATE", Map.of());
      step(client, 30_000);
      assertThat(client.snapshot().path("self").path("paused").asBoolean()).isFalse();
      time.advance(1);
      client.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message.path("payload").path("self").path("paused").asBoolean());
      assertThat(client.snapshot().path("self").path("paused").asBoolean()).isTrue();
      long stoppedTicks =
          client.snapshot().path("self").path("simulation").path("physics").path("ticks").asLong();
      client.ok("CHAT_SEND", Map.of("text", "Chat is available while paused"));
      assertThat(
              client
                  .command("CHAT_SEND", Map.of("text", "Too fast"))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("RATE_LIMITED");
      client.ok("HEARTBEAT", Map.of("nonce", "still-paused"));
      idle(client, 899_999);
      assertThat(memberships.find(client.owner)).isNotNull();
      assertThat(
              client
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("ticks")
                  .asLong())
          .isEqualTo(stoppedTicks);
      time.advance(1);
      client.await(message -> message.path("type").asText().equals("ROOM_LEFT"));
      assertThat(memberships.find(client.owner)).isNull();
      var current = client.request("/community/current", "GET", null);
      assertThat(current.path("run").path("id").asText()).isEqualTo(join.path("playId").asText());
      assertThat(current.path("saveStatus").asText()).isEqualTo("SAVED");
    }
  }

  @Test
  void repeatedResumeCommandsDoNotAdvanceTheSimulationClock() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      client.ok("JOIN_COMMUNITY", client.communityRequest());
      var membership = memberships.find(client.owner);
      Object tower =
          ((Map<?, ?>) ReflectionTestUtils.getField(server, "towers")).get(membership.roomId());
      var actor = (SerialExecutor) ReflectionTestUtils.getField(tower, "actor");
      var before = new CompletableFuture<Long>();
      actor.execute(
          () -> {
            ReflectionTestUtils.invokeMethod(tower, "advance");
            ReflectionTestUtils.invokeMethod(server, "snapshots", tower);
            before.complete((Long) ReflectionTestUtils.getField(tower, "serverTick"));
          });
      long tick = before.get(8, TimeUnit.SECONDS);
      for (int command = 0; command < 10; command++)
        client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", false));
      var after = new CompletableFuture<Long>();
      actor.execute(() -> after.complete((Long) ReflectionTestUtils.getField(tower, "serverTick")));
      assertThat(after.get(8, TimeUnit.SECONDS)).isEqualTo(tick);
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void airbornePauseWaitsForLandingAndResumeHasNewGenerationWithoutPausedTime() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      var map = json.convertValue(shared.map(), GameMap.class);
      var game =
          new GameSimulation(
              map,
              new Physics(
                  json.convertValue(
                      shared.physics(),
                      new com.fasterxml.jackson.core.type.TypeReference<Map<String, Number>>() {})),
              shared.adventure(),
              false,
              false);
      var initial = records.open(client.owner, true, null, game.snapshot());
      double maximum = 0;
      long peak = 0;
      for (int tick = 0; tick < 40; tick++) {
        game.tick(new PlayerInput(false, false, true));
        if (game.physics().progress() > maximum) {
          maximum = game.physics().progress();
          peak = game.physics().snapshot().ticks;
        }
      }
      assertThat(game.physics().snapshot().grounded).isFalse();
      records.save(
          new CommunityRuns.Write(
              initial.id(), client.owner, 2, "ACTIVE", game.snapshot(), 0, maximum, peak, null));
      client.connect();
      client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      assertCurrentProgress(client, client.snapshot(), 0);
      var paused = client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", true));
      assertThat(paused.path("pausePending").asBoolean()).isTrue();
      assertThat(paused.path("paused").asBoolean()).isFalse();
      for (int attempt = 0;
          attempt < 50
              && !client
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("grounded")
                  .asBoolean();
          attempt++) step(client, 100);
      var settled = client.snapshot();
      assertThat(settled.path("self").path("paused").asBoolean()).isTrue();
      assertThat(
              settled.path("self").path("simulation").path("physics").path("grounded").asBoolean())
          .isTrue();
      long ticks = settled.path("self").path("simulation").path("physics").path("ticks").asLong();
      assertThat(ticks).isGreaterThan(40);
      idle(client, 60_000);
      assertThat(
              client
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("ticks")
                  .asLong())
          .isEqualTo(ticks);
      var resume = client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", false));
      assertThat(resume.path("generation").asLong()).isEqualTo(2);
      time.advance(50);
      client.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message.path("payload").path("generation").asLong() == 2
                  && message.path("payload").path("serverTick").asLong()
                      > settled.path("serverTick").asLong());
      assertThat(
              client
                  .ok("SET_COMMUNITY_PAUSED", Map.of("paused", false))
                  .path("generation")
                  .asLong())
          .isEqualTo(2);
      var left = client.ok("LEAVE_ROOM", Map.of());
      assertThat(left.path("roomId").asText()).isNotBlank();
      assertThat(
              client
                  .request("/community/current", "GET", null)
                  .path("run")
                  .path("elapsedTimeMs")
                  .asLong())
          .isEqualTo((ticks + 3) * 1000 / 60);
    }
  }

  @Test
  void disconnectedSlotUsesFiveMinuteDeadlineAndNewJoinContinuesCommittedRun() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var joined = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", true));
      client.disconnect();
      GameClient.until(
          () ->
              TestDatabase.get()
                      .jdbc
                      .queryForObject(
                          "SELECT revision FROM play_runs WHERE id=?",
                          Long.class,
                          joined.path("playId").asText())
                  >= 3);
      time.advance(299_999);
      Thread.sleep(50);
      assertThat(memberships.find(client.owner)).isNotNull();
      time.advance(1);
      GameClient.until(() -> memberships.find(client.owner) == null);
      client.connect();
      var continued = client.ok("JOIN_COMMUNITY", client.communityRequest());
      assertThat(continued.path("playId").asText()).isEqualTo(joined.path("playId").asText());
      client.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void failedSaveKeepsMembershipAndResumeCannotBypassDatabaseFailure() throws Exception {
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var joined = client.ok("JOIN_COMMUNITY", client.communityRequest());
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      String trigger = "pause_failure_" + UUID.randomUUID().toString().replace("-", "");
      var jdbc = TestDatabase.get().jdbc;
      jdbc.execute(
          "CREATE TRIGGER "
              + trigger
              + " BEFORE UPDATE ON play_runs FOR EACH ROW BEGIN IF OLD.user_id="
              + client.owner
              + " THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected save failure'; END IF; END");
      try {
        assertThat(client.command("LEAVE_ROOM", Map.of()).path("payload").path("code").asText())
            .isEqualTo("SAVE_FAILED");
        assertThat(memberships.find(client.owner)).isNotNull();
        assertThat(
                client
                    .command("SET_COMMUNITY_PAUSED", Map.of("paused", false))
                    .path("payload")
                    .path("code")
                    .asText())
            .isEqualTo("SAVE_FAILED");
        var state = client.ok("GET_ROOM_STATE", Map.of());
        assertThat(state.path("members").get(0).path("paused").asBoolean()).isTrue();
        assertThat(
                client.messages.stream()
                    .anyMatch(message -> message.path("type").asText().equals("ROOM_LEFT")))
            .isFalse();
      } finally {
        jdbc.execute("DROP TRIGGER " + trigger);
      }
      assertThat(
              client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", false)).path("paused").asBoolean())
          .isFalse();
      client.ok("LEAVE_ROOM", Map.of());
      assertThat(memberships.find(client.owner)).isNull();
      assertThat(client.request("/community/current", "GET", null).path("run").path("id").asText())
          .isEqualTo(joined.path("playId").asText());
    }
  }
}
