package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.context.WebServerApplicationContext;

class RoomRestartIT {
  private org.springframework.context.ConfigurableApplicationContext launch() {
    var db = TestDatabase.get().dataSource;
    return new SpringApplicationBuilder(
            JumpKingApplication.class, RoomRaceIT.TimeConfiguration.class)
        .run(
            "--server.port=0",
            "--spring.datasource.url=" + db.getUrl(),
            "--spring.datasource.username=" + db.getUsername(),
            "--spring.datasource.password=" + db.getPassword(),
            "--app.allowed-origins=http://allowed.test",
            "--app.checkpoint-interval-ms=25");
  }

  @Test
  void restartClosesAnOfflineMatchUsingOnlyCommittedMetricsAndDoesNotRestoreItsRoom()
      throws Exception {
    String match, room;
    long duration, owner;
    var jdbc = TestDatabase.get().jdbc;
    try (var first = launch()) {
      int port = ((WebServerApplicationContext) first).getWebServer().getPort();
      try (var a = new GameClient(port);
          var b = new GameClient(port)) {
        a.register();
        b.register();
        owner = a.owner;
        a.connect();
        b.connect();
        room = a.ok("CREATE_ROOM", Map.of()).path("roomId").asText();
        b.ok("JOIN_ROOM", Map.of("roomId", room));
        a.ok("START_GAME", Map.of());
        match =
            a.await(message -> message.path("type").asText().equals("GAME_STARTED"))
                .path("payload")
                .path("playId")
                .asText();
        var time = first.getBean(RoomRaceIT.TestTime.class);
        time.advance(3000);
        a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
        a.disconnect();
        b.disconnect();
        GameClient.until(
            () ->
                jdbc.queryForObject("SELECT COUNT(*) FROM matches WHERE id=?", Integer.class, match)
                    == 1);
        duration =
            jdbc.queryForObject("SELECT duration_ticks FROM matches WHERE id=?", Long.class, match);
      }
    }
    assertThat(
            jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, match))
        .isEqualTo("ABORTED");
    try (var restarted = launch()) {
      assertThat(
              jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, match))
          .isEqualTo("ABORTED");
      assertThat(
              jdbc.queryForObject(
                  "SELECT duration_ticks FROM matches WHERE id=?", Long.class, match))
          .isEqualTo(duration);
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='DNF' AND is_winner=FALSE AND `rank` IS NOT NULL",
                  Integer.class,
                  match))
          .isEqualTo(2);
      assertThat(restarted.getBean(Memberships.class).find(owner)).isNull();
      var result =
          restarted.getBean(jumpking.service.RecordsService.class).detail(owner, "ROOM", match);
      assertThat(result.path("participants").size()).isEqualTo(2);
      var before =
          jdbc.queryForList(
              "SELECT revision,play_ticks,jumps,falls,`rank`,ended_at FROM play_runs WHERE match_id=? ORDER BY id",
              match);
      restarted.getBean(jumpking.service.RoomRuns.class).recoverAborted();
      assertThat(
              jdbc.queryForList(
                  "SELECT revision,play_ticks,jumps,falls,`rank`,ended_at FROM play_runs WHERE match_id=? ORDER BY id",
                  match))
          .isEqualTo(before);
    }
  }

  @Test
  void startupRecoversCommittedMetricsWithoutAnyRoomStateFromThePreviousProcess() {
    var jdbc = TestDatabase.get().jdbc;
    String match = java.util.UUID.randomUUID().toString();
    try (var first = launch()) {
      var started = java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
      var runs = new java.util.ArrayList<jumpking.service.RoomRuns.Run>();
      for (int index = 0; index < 2; index++) {
        long owner = TestDatabase.get().account();
        runs.add(
            new jumpking.service.RoomRuns.Run(
                java.util.UUID.randomUUID().toString(),
                owner,
                "Peer " + index,
                "ACTIVE",
                120,
                3,
                1,
                180,
                360,
                100,
                null,
                null,
                false,
                null));
      }
      first
          .getBean(jumpking.service.RoomRuns.class)
          .save(
              new jumpking.service.RoomRuns.Write(
                  match,
                  "ABCDEF",
                  "RACE",
                  null,
                  1,
                  false,
                  3,
                  1,
                  started,
                  null,
                  120,
                  null,
                  runs,
                  java.util.Set.of()));
    }
    assertThat(
            jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, match))
        .isNull();
    try (var restarted = launch()) {
      assertThat(restarted.getBean(RoomDirectory.class).find("ABCDEF")).isNull();
      assertThat(
              jdbc.queryForObject("SELECT end_reason FROM matches WHERE id=?", String.class, match))
          .isEqualTo("ABORTED");
      assertThat(
              jdbc.queryForObject("SELECT map_level FROM matches WHERE id=?", Integer.class, match))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject(
                  "SELECT duration_ticks FROM matches WHERE id=?", Long.class, match))
          .isEqualTo(120);
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM play_runs WHERE match_id=? AND status='DNF' AND play_ticks=120 AND jumps=3 AND falls=1 AND `rank`=1 AND is_winner=FALSE",
                  Integer.class,
                  match))
          .isEqualTo(2);
    }
  }
}
