package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import jumpking.JumpKingApplication;
import jumpking.config.NetworkSettings;
import jumpking.game.SharedData;
import jumpking.network.GameEnvelope;
import jumpking.support.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;

/** Thực nghiệm opt-in trên HTTP/WS/MySQL thật; không dùng thời gian giả hoặc Fly. */
@EnabledIfEnvironmentVariable(named = "JK_WORKLOAD_RUN", matches = "true")
@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.allowed-origins=http://allowed.test,http://workload.test")
class OnlineWorkloadIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @LocalServerPort int port;
  @Autowired NetworkSettings limits;
  @Autowired SharedData shared;
  private final ObjectMapper json = new ObjectMapper();
  private static final long SAMPLE_MS = 5000;

  private static final class Probe implements GameClient.Observer {
    final List<Long> snapshots = new CopyOnWriteArrayList<>();
    final AtomicLong bytes = new AtomicLong(), messages = new AtomicLong();
    final List<String> errors = new CopyOnWriteArrayList<>();
    final Map<String, Long> sent = new ConcurrentHashMap<>();
    final List<Double> rtts = new CopyOnWriteArrayList<>();
    volatile boolean sampling;
    volatile long firstTick = -1, lastTick = -1;

    @Override
    public void receive(com.fasterxml.jackson.databind.JsonNode message, long nanos, int count) {
      if (message.path("type").asText().equals("ERROR"))
        errors.add(message.path("payload").path("code").asText());
      if (message.path("type").asText().equals("PONG")) {
        Long begin = sent.remove(message.path("payload").path("nonce").asText());
        if (begin != null) rtts.add((nanos - begin) / 1e6);
      }
      if (!sampling) return;
      bytes.addAndGet(count);
      messages.incrementAndGet();
      if (message.path("type").asText().equals("GAME_SNAPSHOT")) {
        long tick =
            message
                .path("payload")
                .path("self")
                .path("simulation")
                .path("physics")
                .path("ticks")
                .asLong();
        if (firstTick < 0) firstTick = tick;
        lastTick = tick;
        snapshots.add(nanos);
      }
    }
  }

  private GameClient accountFixture() throws Exception {
    var client = new GameClient(port);
    client.register();
    return client;
  }

  @Test
  void measuresOneTwoTenPlayersAndMultipleRoomsWithoutChangingServerLimits() throws Exception {
    var reports = new ArrayList<Map<String, Object>>();
    reports.add(sample(true, 1, 1));
    reports.add(sample(false, 1, 2));
    reports.add(sample(false, 1, 10));
    reports.add(sample(false, 2, 3));
    var output = new LinkedHashMap<String, Object>();
    output.put("recordedAt", Instant.now().toString());
    output.put("java", System.getProperty("java.version"));
    output.put("os", System.getProperty("os.name"));
    output.put("processors", Runtime.getRuntime().availableProcessors());
    output.put("sampleMs", SAMPLE_MS);
    output.put(
        "limitations",
        List.of(
            "Loopback; clients and server share one JVM; CPU and heap include the load driver",
            "Five-second samples are smoke measurements, not a production capacity estimate",
            "RTT measured from send to listener receipt; no clock synchronization or one-way latency estimate",
            "Compute tick timings exclude scheduling, serialization, socket and JDBC"));
    output.put("scenarios", reports);
    output.put("computeTicks", computeTicks());
    Path report = Path.of("../../.local/reports/online-workload.json");
    Files.createDirectories(report.getParent());
    json.writerWithDefaultPrettyPrinter().writeValue(report.toFile(), output);
  }

  private Map<String, Object> sample(boolean community, int rooms, int playersPerRoom)
      throws Exception {
    var clients = new ArrayList<GameClient>();
    var probes = new ArrayList<Probe>();
    var hosts = new ArrayList<GameClient>();
    var sender = Executors.newSingleThreadScheduledExecutor();
    var failure = new AtomicReference<Throwable>();
    try {
      for (int group = 0; group < rooms; group++) {
        String roomId = null;
        for (int index = 0; index < playersPerRoom; index++) {
          var client = community ? new GameClient(port) : accountFixture();
          clients.add(client);
          var probe = new Probe();
          probes.add(probe);
          client.observer = probe;
          if (community) client.register();
          client.connect();
          if (index == 0) {
            hosts.add(client);
            roomId =
                client
                    .ok(
                        community ? "JOIN_COMMUNITY" : "CREATE_ROOM",
                        community ? Map.of() : Map.of())
                    .path("roomId")
                    .asText();
          } else client.ok("JOIN_ROOM", Map.of("roomId", roomId + index));
        }
      }
      if (!community) for (var host : hosts) host.ok("START_GAME", Map.of());
      for (var client : clients)
        client.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      var sequence = new AtomicLong();
      sender.scheduleAtFixedRate(
          () -> {
            try {
              long seq = sequence.incrementAndGet();
              boolean jump = seq % 90 < 36;
              for (var client : clients) {
                var state = client.snapshot();
                client.input(
                    Map.of(
                        "playId",
                        state.path("playId").asText(),
                        "generation",
                        state.path("generation").asLong(),
                        "seq",
                        seq,
                        "left",
                        false,
                        "right",
                        false,
                        "jump",
                        jump));
              }
            } catch (Throwable error) {
              failure.compareAndSet(null, error);
            }
          },
          0,
          1_000_000_000L / 60,
          TimeUnit.NANOSECONDS);
      Thread.sleep(1000);
      var os =
          (com.sun.management.OperatingSystemMXBean)
              java.lang.management.ManagementFactory.getOperatingSystemMXBean();
      long cpu = os.getProcessCpuTime(), started = System.nanoTime(), heap = 0;
      probes.forEach(probe -> probe.sampling = true);
      while (System.nanoTime() - started < TimeUnit.MILLISECONDS.toNanos(SAMPLE_MS)) {
        for (int index = 0; index < clients.size(); index++) {
          String nonce = UUID.randomUUID().toString();
          probes.get(index).sent.put(nonce, System.nanoTime());
          clients.get(index).ok("HEARTBEAT", Map.of("nonce", nonce));
        }
        heap =
            Math.max(
                heap,
                java.lang.management.ManagementFactory.getMemoryMXBean()
                    .getHeapMemoryUsage()
                    .getUsed());
        Thread.sleep(100);
      }
      double seconds = (System.nanoTime() - started) / 1e9,
          cpuSeconds = (os.getProcessCpuTime() - cpu) / 1e9;
      probes.forEach(probe -> probe.sampling = false);
      sender.shutdown();
      assertThat(sender.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
      assertThat(failure.get()).isNull();
      var intervals = new ArrayList<Double>();
      var rates = new ArrayList<Double>();
      var tickRates = new ArrayList<Double>();
      for (var probe : probes) {
        assertThat(probe.errors).isEmpty();
        assertThat(probe.snapshots.size()).isGreaterThan(10);
        assertThat(probe.lastTick).isGreaterThan(probe.firstTick);
        for (int index = 1; index < probe.snapshots.size(); index++)
          intervals.add((probe.snapshots.get(index) - probe.snapshots.get(index - 1)) / 1e6);
        double span = (probe.snapshots.getLast() - probe.snapshots.getFirst()) / 1e9;
        rates.add((probe.snapshots.size() - 1) / span);
        tickRates.add((probe.lastTick - probe.firstTick) / span);
      }
      var report = new LinkedHashMap<String, Object>();
      report.put("kind", community ? "COMMUNITY" : "ROOM");
      report.put("rooms", rooms);
      report.put("playersPerRoom", playersPerRoom);
      report.put("seconds", seconds);
      report.put(
          "rttMs", distribution(probes.stream().flatMap(probe -> probe.rtts.stream()).toList()));
      report.put("snapshotIntervalMs", distribution(intervals));
      report.put("snapshotsPerSecondPerClient", distribution(rates));
      report.put("simulationTicksPerSecondPerClient", distribution(tickRates));
      report.put(
          "serverOutboundMessages", probes.stream().mapToLong(probe -> probe.messages.get()).sum());
      report.put(
          "serverOutboundBytes", probes.stream().mapToLong(probe -> probe.bytes.get()).sum());
      report.put("jvmCpuCorePercent", cpuSeconds / seconds * 100);
      report.put("peakSampledHeapBytes", heap);
      for (var host : hosts)
        if (!community) {
          long begin = System.nanoTime();
          host.ok("END_MATCH", Map.of());
          host.await(
              message ->
                  message.path("type").asText().equals("ROOM_STATE")
                      && message
                          .path("payload")
                          .path("result")
                          .path("saveStatus")
                          .asText()
                          .equals("SAVED"));
          report.put("lastFinalSaveMs", (System.nanoTime() - begin) / 1e6);
        }
      for (var client : clients) client.ok("LEAVE_ROOM", Map.of());
      return report;
    } finally {
      sender.shutdownNow();
      for (var client : clients) client.close();
    }
  }

  private List<Map<String, Object>> computeTicks() {
    var reports = new ArrayList<Map<String, Object>>();
    for (int players : List.of(2, 10)) {
      var roster =
          java.util.stream.IntStream.range(0, players)
              .mapToObj(
                  index ->
                      new RoomMatch.Spec(
                          "player-" + index, index + 1L, "Player " + index, index, 1))
              .toList();
      var match = new RoomMatch("ABCDEF", RoomSettings.defaults(), roster, shared, limits, false);
      var instant = Instant.parse("2026-01-01T00:00:00Z");
      match.start(instant);
      var samples = new ArrayList<Double>();
      int overruns = 0;
      for (int tick = 0; tick < 2400; tick++) {
        long now = 10_000_000_000L + tick * (1_000_000_000L / 60);
        var input =
            new GameEnvelope(
                "PLAYER_INPUT",
                null,
                json.valueToTree(
                    Map.of(
                        "playId",
                        match.id,
                        "generation",
                        1,
                        "seq",
                        tick + 1,
                        "left",
                        false,
                        "right",
                        false,
                        "jump",
                        tick % 120 >= 30 && tick % 120 < 50)));
        for (var player : match.players.values()) player.input.offer(input, now, false);
        long begin = System.nanoTime();
        match.tick(now, instant);
        double elapsed = (System.nanoTime() - begin) / 1e6;
        if (tick >= 600) {
          samples.add(elapsed);
          if (elapsed > 1000.0 / 60) overruns++;
        }
      }
      reports.add(
          Map.of(
              "players",
              players,
              "warmupTicks",
              600,
              "tickMs",
              distribution(samples),
              "over16_67ms",
              overruns));
    }
    return reports;
  }

  private Map<String, Object> distribution(List<Double> values) {
    var sorted = values.stream().sorted().toList();
    var output = new LinkedHashMap<String, Object>();
    output.put("samples", sorted.size());
    for (int percentile : List.of(50, 95, 99))
      output.put(
          "p" + percentile,
          sorted.get(Math.max(0, (int) Math.ceil(sorted.size() * percentile / 100.0) - 1)));
    return output;
  }
}
