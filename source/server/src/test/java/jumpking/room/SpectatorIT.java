package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import jumpking.JumpKingApplication;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = {JumpKingApplication.class, SpectatorIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.fly-enabled=true"})
class SpectatorIT {
  static class MovingTime extends MonotonicTime {
    private final java.util.concurrent.atomic.AtomicLong offset =
        new java.util.concurrent.atomic.AtomicLong();

    @Override
    public long nanos() {
      return super.nanos() + offset.get();
    }

    void advance(long milliseconds) {
      offset.addAndGet(java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(milliseconds));
    }
  }

  @org.springframework.boot.test.context.TestConfiguration
  static class TimeConfiguration {
    @org.springframework.context.annotation.Bean
    @org.springframework.context.annotation.Primary
    MovingTime time() {
      return new MovingTime();
    }
  }

  @org.springframework.beans.factory.annotation.Autowired MovingTime time;
  @org.springframework.beans.factory.annotation.Autowired jumpking.game.SharedData shared;

  @org.springframework.beans.factory.annotation.Autowired
  com.fasterxml.jackson.databind.ObjectMapper json;

  @org.springframework.beans.factory.annotation.Autowired
  jumpking.service.CommunityRuns communityRuns;

  private static final int VITE_PORT = jumpking.support.BrowserHarness.freePort();
  @LocalServerPort int port;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add(
        "app.allowed-origins", () -> "http://allowed.test,http://127.0.0.1:" + VITE_PORT);
  }

  private GameClient player() throws Exception {
    var client = new GameClient(port);
    try {
      client.register();
      client.connect();
      return client;
    } catch (Exception | AssertionError error) {
      client.close();
      throw error;
    }
  }

  private JsonNode watching(GameClient client, String id) throws Exception {
    return client
        .await(
            m ->
                m.path("type").asText().equals("GAME_SNAPSHOT")
                    && m.path("payload")
                        .path("spectating")
                        .path("player")
                        .path("playerId")
                        .asText()
                        .equals(id))
        .path("payload");
  }

  private Map<String, Object> stop() {
    var p = new HashMap<String, Object>();
    p.put("playerId", null);
    return p;
  }

  @Test
  void watchingPastTheAfkDeadlineKeepsTheViewerClockRunning() throws Exception {
    try (var viewer = player();
        var target = player()) {
      viewer.ok("JOIN_COMMUNITY", viewer.communityRequest());
      var other = target.ok("JOIN_COMMUNITY", target.communityRequest());
      String id = other.path("playerId").asText();
      viewer.ok("SET_SPECTATE", Map.of("playerId", id));
      var before = watching(viewer, id);
      time.advance(61_000);
      var after =
          viewer
              .await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload").path("elapsedTimeMs").asLong()
                              > before.path("elapsedTimeMs").asLong() + 1000)
              .path("payload");
      assertThat(after.path("self").path("paused").asBoolean()).isFalse();
      assertThat(after.path("spectating").path("player").path("playerId").asText()).isEqualTo(id);
      viewer.ok("SET_SPECTATE", stop());
      assertThat(viewer.ok("GET_ROOM_STATE", Map.of()).path("members").isEmpty()).isFalse();
      viewer.ok("LEAVE_ROOM", Map.of());
      target.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void communityKeepsViewerClockRunningAndRejectsForeignTargets() throws Exception {
    try (var viewer = player();
        var target = player();
        var outsider = player()) {
      var joined = viewer.ok("JOIN_COMMUNITY", viewer.communityRequest());
      var other = target.ok("JOIN_COMMUNITY", target.communityRequest());
      assertThat(other.path("roomId")).isEqualTo(joined.path("roomId"));
      var foreign = outsider.ok("CREATE_ROOM", Map.of());
      String id = other.path("playerId").asText();
      assertThat(
              viewer
                  .command("SET_SPECTATE", Map.of("playerId", foreign.path("playerId").asText()))
                  .path("payload")
                  .path("code")
                  .asText())
          .isEqualTo("INVALID_SPECTATE_TARGET");
      viewer.ok("SET_SPECTATE", Map.of("playerId", id));
      var view = watching(viewer, id);
      assertThat(view.path("playId")).isEqualTo(joined.path("playId"));
      assertThat(view.path("spectating").path("playId")).isEqualTo(other.path("playId"));
      assertThat(view.path("spectating").path("player").path("positionRevision").isIntegralNumber())
          .isTrue();
      assertThat(view.path("spectating").has("simulation")).isFalse();
      assertThat(view.path("spectating").has("reconnectToken")).isFalse();
      assertThat(view.path("self").path("paused").asBoolean()).isFalse();
      long elapsed = view.path("elapsedTimeMs").asLong();
      long previous = viewer.snapshot().path("serverTick").asLong();
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong() > previous + 5);
      assertThat(viewer.snapshot().path("elapsedTimeMs").asLong()).isGreaterThan(elapsed);
      viewer.ok("SET_COMMUNITY_PAUSED", Map.of("paused", true));
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("self").path("paused").asBoolean());
      viewer.ok("SET_COMMUNITY_PAUSED", Map.of("paused", false));
      var resumed = watching(viewer, id);
      assertThat(resumed.path("spectating").path("player").path("playerId").asText()).isEqualTo(id);
      target.ok("LEAVE_ROOM", Map.of());
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong() > previous + 5
                  && m.path("payload").path("spectating").isNull());
      assertThat(viewer.snapshot().path("self").path("paused").asBoolean()).isFalse();
      viewer.ok("SET_SPECTATE", stop());
      viewer.ok("SET_COMMUNITY_PAUSED", Map.of("paused", false));
      viewer.ok("LEAVE_ROOM", Map.of());
      outsider.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void roomKeepsTheClockRunningAndDoesNotAcceptMovementWhileWatching() throws Exception {
    try (var viewer = player();
        var target = player()) {
      var joined = viewer.ok("CREATE_ROOM", Map.of());
      var other = target.ok("JOIN_ROOM", Map.of("roomId", joined.path("roomId").asText()));
      viewer.ok("START_GAME", Map.of());
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && !m.path("payload").path("self").path("paused").asBoolean());
      var current = viewer.snapshot();
      String play = current.path("playId").asText();
      long generation = current.path("generation").asLong();
      viewer.input(
          Map.of(
              "playId",
              play,
              "generation",
              generation,
              "seq",
              1,
              "left",
              false,
              "right",
              false,
              "jump",
              false,
              "up",
              true,
              "freeFlight",
              true));
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload")
                          .path("self")
                          .path("simulation")
                          .path("physics")
                          .path("y")
                          .asDouble()
                      < 150);
      viewer.input(
          Map.of(
              "playId",
              play,
              "generation",
              generation,
              "seq",
              2,
              "left",
              false,
              "right",
              false,
              "jump",
              false,
              "freeFlight",
              false));
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("self").path("lastProcessedInputSeq").asLong() >= 2);
      viewer.ok("SET_SPECTATE", Map.of("playerId", other.path("playerId").asText()));
      var view = watching(viewer, other.path("playerId").asText());
      assertThat(view.path("spectating").path("player").path("positionRevision").isIntegralNumber())
          .isTrue();
      double x = view.path("self").path("simulation").path("physics").path("x").asDouble();
      viewer.input(
          Map.of(
              "playId",
              view.path("playId").asText(),
              "generation",
              view.path("generation").asLong(),
              "seq",
              3,
              "left",
              false,
              "right",
              true,
              "jump",
              false));
      long tick = view.path("serverTick").asLong();
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong() > tick + 5);
      assertThat(viewer.snapshot().path("elapsedTimeMs").asLong())
          .isGreaterThan(view.path("elapsedTimeMs").asLong());
      assertThat(
              viewer
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("x")
                  .asDouble())
          .isEqualTo(x);
      assertThat(
              viewer
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("y")
                  .asDouble())
          .isGreaterThan(view.path("self").path("simulation").path("physics").path("y").asDouble());
      viewer.ok("SET_SPECTATE", stop());
      long returnedAt = viewer.snapshot().path("serverTick").asLong();
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong() > returnedAt
                  && m.path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("grounded")
                      .asBoolean()
                  && !m.path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("phasingFall")
                      .asBoolean());
      viewer.input(
          Map.of(
              "playId",
              view.path("playId").asText(),
              "generation",
              view.path("generation").asLong(),
              "seq",
              4,
              "left",
              false,
              "right",
              true,
              "jump",
              false));
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("self").path("lastProcessedInputSeq").asLong() >= 4
                  && m.path("payload")
                          .path("self")
                          .path("simulation")
                          .path("physics")
                          .path("x")
                          .asDouble()
                      > x);
      assertThat(viewer.snapshot().path("spectating").isNull()).isTrue();
      assertThat(
              viewer
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("x")
                  .asDouble())
          .isGreaterThan(x);
      viewer.ok("SET_SPECTATE", Map.of("playerId", other.path("playerId").asText()));
      watching(viewer, other.path("playerId").asText());
      long endedAfter = viewer.snapshot().path("serverTick").asLong();
      viewer.ok("END_MATCH", Map.of());
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong() > endedAfter
                  && m.path("payload").path("self").path("paused").asBoolean()
                  && m.path("payload").path("spectating").isNull());
      viewer.ok("LEAVE_ROOM", Map.of());
      target.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  void disconnectStopsWatchingAndReconnectNeverRestoresTheTarget() throws Exception {
    try (var viewer = player();
        var target = player()) {
      var joined = viewer.ok("JOIN_COMMUNITY", viewer.communityRequest());
      var other = target.ok("JOIN_COMMUNITY", target.communityRequest());
      String id = other.path("playerId").asText();
      viewer.ok("SET_SPECTATE", Map.of("playerId", id));
      var before = watching(viewer, id);
      target.disconnect();
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("serverTick").asLong()
                      > before.path("serverTick").asLong()
                  && m.path("payload").path("spectating").isNull());
      target.connect();
      target.ok("RECONNECT", reconnect(other));
      viewer.ok("SET_SPECTATE", Map.of("playerId", id));
      watching(viewer, id);
      viewer.disconnect();
      viewer.connect();
      viewer.ok("RECONNECT", reconnect(joined));
      var resumed =
          viewer
              .await(
                  m ->
                      m.path("type").asText().equals("GAME_SNAPSHOT")
                          && m.path("payload").path("generation").asLong()
                              > before.path("generation").asLong())
              .path("payload");
      assertThat(resumed.path("playId")).isEqualTo(joined.path("playId"));
      assertThat(resumed.path("spectating").isNull()).isTrue();
      assertThat(resumed.path("self").path("paused").asBoolean()).isTrue();
      viewer.ok("LEAVE_ROOM", Map.of());
      target.ok("LEAVE_ROOM", Map.of());
    }
  }

  private Map<String, String> reconnect(JsonNode context) {
    return Map.of(
        "roomId",
        context.path("roomId").asText(),
        "playerId",
        context.path("playerId").asText(),
        "reconnectToken",
        context.path("reconnectToken").asText());
  }

  @Test
  void watchingDoesNotExtendTheCommunityPauseDeadline() throws Exception {
    try (var viewer = player();
        var target = player()) {
      viewer.ok("JOIN_COMMUNITY", viewer.communityRequest());
      var other = target.ok("JOIN_COMMUNITY", target.communityRequest());
      viewer.ok("SET_COMMUNITY_PAUSED", Map.of("paused", true));
      viewer.ok("SET_SPECTATE", Map.of("playerId", other.path("playerId").asText()));
      viewer.await(
          m ->
              m.path("type").asText().equals("GAME_SNAPSHOT")
                  && m.path("payload").path("self").path("paused").asBoolean());
      time.advance(15 * 60 * 1000L + 1000);
      viewer.await(m -> m.path("type").asText().equals("ROOM_LEFT"));
      assertThat(viewer.request("/community/current", "GET", null).path("run").isNull()).isFalse();
      target.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(
      named = "E2E_BROWSER_PATH",
      matches = ".+")
  void browsersPauseCommunityWhenTheWatchedPlayerLeavesDisconnectsOrFinishes() throws Exception {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    String alternativeName = "watch_alt_" + suffix;
    String finishName = "watch_finish_" + suffix;
    try (var alternative = new GameClient(port);
        var finisher = new GameClient(port);
        var heartbeats = java.util.concurrent.Executors.newSingleThreadScheduledExecutor()) {
      alternative.register(alternativeName);
      alternative.connect();
      alternative.ok("JOIN_COMMUNITY", alternative.communityRequest());
      finisher.register(finishName);
      var before = jumpking.support.MainBabeRoute.beforeFinish(shared, json);
      // Giữ checkpoint trước đích để browser kịp chọn xem; input thật sẽ hạ xuống nền Finish.
      before.physics().freeFlight = true;
      before.physics().grounded = false;
      before.physics().vx = before.physics().vy = 0;
      communityRuns.open(finisher.owner, true, null, before);
      // Fixture không có browser; giữ kết nối bằng heartbeat như client thật.
      var keepAlive =
          heartbeats.scheduleAtFixedRate(
              () -> {
                try {
                  alternative.ok("HEARTBEAT", Map.of("nonce", "spectate-loss-fixture"));
                } catch (Exception failure) {
                  throw new java.util.concurrent.CompletionException(failure);
                }
              },
              0,
              10,
              java.util.concurrent.TimeUnit.SECONDS);
      jumpking.support.BrowserHarness.run(
          port,
          VITE_PORT,
          "spectating-loss",
          "e2e/spectating-loss-online.spec.ts",
          Map.of(
              "E2E_SPECTATE_ONLINE",
              "true",
              "E2E_SPECTATE_ALTERNATIVE",
              alternativeName,
              "E2E_SPECTATE_FINISH_USERNAME",
              finishName));
      assertThat(keepAlive.isDone()).isFalse();
      keepAlive.cancel(false);
      alternative.ok("LEAVE_ROOM", Map.of());
    }
  }

  @Test
  @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(
      named = "E2E_BROWSER_PATH",
      matches = ".+")
  void browsersFollowPlayersAcrossScreensAndReturnToTheirOwnGame() throws Exception {
    jumpking.support.BrowserHarness.run(
        port,
        VITE_PORT,
        "spectating",
        "e2e/spectating-online.spec.ts",
        Map.of("E2E_SPECTATE_ONLINE", "true"));
  }
}
