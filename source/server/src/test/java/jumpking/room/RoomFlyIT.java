package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import jumpking.JumpKingApplication;
import jumpking.game.SharedData;
import jumpking.network.SerialExecutor;
import jumpking.support.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import org.springframework.test.util.ReflectionTestUtils;

@SpringBootTest(
    classes = {JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class},
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "app.allowed-origins=http://allowed.test,http://room-flight.test",
      "spring.profiles.active=local",
      "app.fly-enabled=true",
      "app.checkpoint-interval-ms=25"
    })
class RoomFlyIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired RoomRaceIT.TestTime time;
  @Autowired RoomManager server;
  @Autowired SharedData shared;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  private void arrange(String id, Consumer<RoomMatch> operation) throws Exception {
    Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "rooms")).get(id);
    var done = new CompletableFuture<Void>();
    ((SerialExecutor) ReflectionTestUtils.getField(room, "actor"))
        .execute(
            () -> {
              try {
                operation.accept((RoomMatch) ReflectionTestUtils.getField(room, "match"));
                done.complete(null);
              } catch (Throwable error) {
                done.completeExceptionally(error);
              }
            });
    done.get(8, TimeUnit.SECONDS);
  }

  private void input(
      GameClient client,
      String play,
      long seq,
      boolean fly,
      boolean right,
      boolean up,
      boolean jump)
      throws Exception {
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
            right,
            "up",
            up,
            "down",
            false,
            "jump",
            jump,
            "freeFlight",
            fly));
    client.ok("GET_ROOM_STATE", Map.of());
    time.advance(50);
    client.await(
        message ->
            message.path("type").asText().equals("GAME_SNAPSHOT")
                && message.path("payload").path("self").path("lastProcessedInputSeq").asLong()
                    == seq);
  }

  @Test
  void allModesAllowFlightPhasingAndCountTheNormalCommittedFinish() throws Exception {
    var before = MainBabeRoute.beforeFinish(shared, json);
    for (String mode : List.of("RACE", "EASY", "HARDCORE", "NO_WALK")) {
      try (var a = new GameClient(port);
          var b = new GameClient(port)) {
        a.register();
        b.register();
        a.connect();
        b.connect();
        var settings = new HashMap<String, Object>();
        settings.put("mode", mode);
        settings.put("mapId", RoomSettings.FINAL_MAP_ID);
        settings.put("timeLimitMinutes", null);
        String room = a.ok("CREATE_ROOM", Map.of("settings", settings)).path("roomId").asText();
        b.ok("JOIN_ROOM", Map.of("roomId", room));
        a.ok("START_GAME", Map.of());
        String play =
            a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
                .path("payload")
                .path("playId")
                .asText();
        time.advance(3000);
        a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
        var initial = a.snapshot().path("self").path("simulation").path("physics");
        input(a, play, 1, true, true, true, false);
        var flying = a.snapshot().path("self").path("simulation").path("physics");
        assertThat(flying.path("freeFlight").asBoolean()).as(mode).isTrue();
        assertThat(flying.path("x").asDouble()).isGreaterThan(initial.path("x").asDouble());
        assertThat(flying.path("y").asDouble()).isLessThan(initial.path("y").asDouble());
        arrange(
            room,
            match -> {
              var player = match.players.values().iterator().next();
              var pose = player.game.physics().snapshot();
              pose.x = 231;
              pose.y = 310;
              pose.grounded = false;
              player.game.physics().restore(pose);
            });
        input(a, play, 2, false, true, false, true);
        var phasing = a.snapshot().path("self").path("simulation").path("physics");
        assertThat(phasing.path("freeFlight").asBoolean()).isFalse();
        assertThat(phasing.path("phasingFall").asBoolean()).isTrue();
        assertThat(phasing.path("x").asDouble()).isEqualTo(231);
        assertThat(phasing.path("jumps").asInt()).isZero();
        for (int step = 0;
            step < 20
                && a.snapshot()
                    .path("self")
                    .path("simulation")
                    .path("physics")
                    .path("phasingFall")
                    .asBoolean();
            step++) {
          long tick = a.snapshot().path("serverTick").asLong();
          time.advance(50);
          a.await(
              message ->
                  message.path("type").asText().equals("GAME_SNAPSHOT")
                      && message.path("payload").path("serverTick").asLong() > tick);
        }
        assertThat(
                a.snapshot()
                    .path("self")
                    .path("simulation")
                    .path("physics")
                    .path("phasingFall")
                    .asBoolean())
            .isFalse();
        input(a, play, 3, false, false, false, false);
        arrange(
            room,
            match -> {
              match.ticks = before.physics().ticks;
              var player = match.players.values().iterator().next();
              player.game.restore(before);
              player.maximum = player.game.physics().progress();
              player.peak = before.physics().ticks;
            });
        time.advance(50);
        a.await(
            message ->
                message.path("type").asText().equals("ROOM_STATE")
                    && message
                        .path("payload")
                        .path("result")
                        .path("saveStatus")
                        .asText()
                        .equals("SAVED"));
        assertThat(a.request("/profile/me", "GET", null).path("total").has("wins")).isFalse();
        assertThat(
                a.request("/history/ROOM/" + play, "GET", null).path("room").path("mode").asText())
            .isEqualTo(mode);
        assertThat(
                TestDatabase.get()
                    .jdbc
                    .queryForObject(
                        "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND user_id=? AND status='FINISHED' AND `rank`=1",
                        Integer.class,
                        play,
                        a.owner))
            .isEqualTo(1);
        a.ok("LEAVE_ROOM", Map.of());
        b.ok("LEAVE_ROOM", Map.of());
      }
    }
  }
}
