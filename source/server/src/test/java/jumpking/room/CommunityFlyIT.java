package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.Map;
import jumpking.JumpKingApplication;
import jumpking.config.FeatureFlags;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.allowed-origins=http://allowed.test", "app.fly-enabled=true"})
class CommunityFlyIT {
  private static final int VITE_PORT = jumpking.support.BrowserHarness.freePort();

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
    properties.add(
        "app.allowed-origins", () -> "http://allowed.test,http://127.0.0.1:" + VITE_PORT);
  }

  @Autowired FeatureFlags flags;
  @LocalServerPort int port;

  @Test
  @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(
      named = "E2E_BROWSER_PATH",
      matches = ".+")
  void browserUsesOneServerPermissionForSoloAndCommunityFlight() throws Exception {
    jumpking.support.BrowserHarness.run(
        port,
        VITE_PORT,
        "fly-online",
        "e2e/(community-fly-online|fly).spec.ts",
        Map.of("E2E_FLY_ONLINE", "true", "E2E_FLY_ENABLED", "true"));
  }

  @Test
  void serverPermittedFlightIsSavedRestoredAndContributesToTheSameCommunityMetrics()
      throws Exception {
    assertThat(flags.flyEnabled()).isTrue();
    try (var client = new GameClient(port)) {
      client.register();
      client.connect();
      var joined = client.ok("JOIN_COMMUNITY", Map.of());
      String run = joined.path("playId").asText();
      client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      double initialY =
          client.snapshot().path("self").path("simulation").path("physics").path("y").asDouble();
      client.input(
          Map.of(
              "playId",
              run,
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
              "up",
              true,
              "down",
              false,
              "freeFlight",
              true));
      client.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message
                      .path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("freeFlight")
                      .asBoolean());
      assertThat(
              client
                  .snapshot()
                  .path("self")
                  .path("simulation")
                  .path("physics")
                  .path("y")
                  .asDouble())
          .isLessThan(initialY);
      client.ok("SET_COMMUNITY_PAUSED", Map.of("paused", true));
      client.ok("LEAVE_ROOM", Map.of());
      var jdbc = TestDatabase.get().jdbc;
      var stored =
          new com.fasterxml.jackson.databind.ObjectMapper()
              .readTree(
                  jdbc.queryForObject(
                      "SELECT snapshot FROM play_runs WHERE id=?", String.class, run));
      assertThat(stored.path("physics").path("freeFlight").asBoolean()).isTrue();
      assertThat(
              jdbc.queryForObject(
                  "SELECT max_progress FROM play_runs WHERE id=?", Double.class, run))
          .isGreaterThan(0);
      var continued = client.ok("JOIN_COMMUNITY", Map.of());
      assertThat(continued.path("playId").asText()).isEqualTo(run);
      client.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message
                      .path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("freeFlight")
                      .asBoolean());
      client.input(
          Map.of(
              "playId",
              run,
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
              "up",
              false,
              "down",
              false,
              "freeFlight",
              false));
      client.await(
          message ->
              message.path("type").asText().equals("GAME_SNAPSHOT")
                  && message.path("payload").path("self").path("lastProcessedInputSeq").asLong()
                      == 1
                  && !message
                      .path("payload")
                      .path("self")
                      .path("simulation")
                      .path("physics")
                      .path("freeFlight")
                      .asBoolean());
      client.ok("LEAVE_ROOM", Map.of());
    }
  }
}
