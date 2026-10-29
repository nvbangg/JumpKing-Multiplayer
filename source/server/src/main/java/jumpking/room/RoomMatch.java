package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.*;
import jumpking.config.NetworkSettings;
import jumpking.game.*;
import jumpking.network.InputFrames;
import jumpking.service.RoomRuns;

/** State trận chỉ được đọc/ghi trên actor của Room; không thực hiện I/O. */
final class RoomMatch {
  record Spec(String playerId, long owner, String nickname, int color, long generation) {}

  static final class Player {
    final Spec spec;
    final String runId = UUID.randomUUID().toString();
    final GameSimulation game;
    final InputFrames input;
    String status = "ACTIVE";
    double currentProgress, maximum;
    long peak;
    Long finish;
    Integer rank;
    Instant endedAt;

    Player(Spec spec, GameSimulation game, InputFrames input) {
      this.spec = spec;
      this.game = game;
      this.input = input;
    }

    RoomRanking.Score score() {
      return new RoomRanking.Score(spec.playerId, status, currentProgress, maximum, finish);
    }
  }

  record Events(Player player, GameSimulation.Events effects) {}

  final String id = UUID.randomUUID().toString(), roomId;
  final RoomSettings settings;
  final RoomItems items;
  final LinkedHashMap<String, Player> players = new LinkedHashMap<>();
  final int tickRate;
  final long limitTicks;
  Instant startedAt, endedAt;
  long ticks, revision;
  long savedRevision;
  RoomRuns.Write terminalWrite;
  final java.util.concurrent.CompletableFuture<Void> durable =
      new java.util.concurrent.CompletableFuture<>();
  String reason, saveStatus = "PENDING";

  RoomMatch(
      String roomId,
      RoomSettings settings,
      List<Spec> roster,
      SharedData shared,
      NetworkSettings limits,
      boolean flyAllowed) {
    if (roster.size() < shared.rules().path("minimumRoomPlayers").asInt()
        || roster.size() > shared.rules().path("roomCapacity").asInt()
        || roster.stream().map(Spec::playerId).distinct().count() != roster.size())
      throw new IllegalArgumentException("Invalid Room roster");
    this.roomId = roomId;
    this.settings = settings;
    var map = shared.roomMap(settings.mapId());
    var physics = shared.tuning();
    tickRate = physics.tickRate;
    items =
        new RoomItems(
            physics, shared.rules().path("items"), java.util.random.RandomGenerator.getDefault());
    limitTicks =
        settings.timeLimitMinutes() == null ? 0 : settings.timeLimitMinutes() * 60L * tickRate;
    JsonNode adventure = shared.adventure();
    for (var spec : roster) {
      var input = new InputFrames(limits.inputFrames(), limits.inputTimeoutMs());
      input.reset(id, spec.generation);
      players.put(
          spec.playerId,
          new Player(
              spec,
              new GameSimulation(
                  map, physics, adventure, flyAllowed, settings.mode().equals("NO_WALK")),
              input));
    }
  }

  void start(Instant now) {
    if (startedAt != null) throw new IllegalStateException("Match has already started");
    startedAt = millis(now);
    if (settings.itemCooldownMinutes() != null) items.start(players.keySet());
  }

  List<Events> tick(long now, Instant instant) {
    if (startedAt == null || endedAt != null) return List.of();
    ticks++;
    if (settings.itemCooldownMinutes() != null) items.advance(ticks);
    var events = new ArrayList<Events>();
    for (var player : players.values()) {
      if (!player.status.equals("ACTIVE")) continue;
      var input = player.input.poll(now);
      if (input.cancel()) player.game.physics().cancelInput();
      if (settings.itemCooldownMinutes() != null) items.hit(player.game.physics(), ticks);
      var effect = player.game.tick(input.input(), settings.mode());
      if (settings.itemCooldownMinutes() != null && effect.movement().contains("JUMP"))
        items.takeoff(
            player.spec.playerId, player.game.physics(), ticks, settings.itemCooldownMinutes());
      events.add(new Events(player, effect));
      double progress = player.game.physics().progress();
      var state = player.game.physics().snapshot();
      boolean isLanded = state.grounded && !state.phasingFall;
      if (isLanded) {
        player.currentProgress = progress;
        if (progress > player.maximum) {
          player.maximum = progress;
          player.peak = state.ticks;
        }
      }
      if (player.game.finished()) {
        player.status = "FINISHED";
        player.finish = ticks;
      }
    }
    if (players.values().stream().anyMatch(player -> player.finish != null))
      finish("FINISH", instant);
    else if (limitTicks > 0 && ticks >= limitTicks) finish("TIME_LIMIT", instant);
    return events;
  }

  void useItem(String id, Set<String> connected) {
    var targets = new LinkedHashMap<String, Simulation>();
    players.forEach(
        (key, player) -> {
          if (connected.contains(key) && player.status.equals("ACTIVE"))
            targets.put(key, player.game.physics());
        });
    items.use(id, players.get(id).game.physics(), targets, ticks, settings.itemCooldownMinutes());
  }

  void abandon(String id, Instant now) {
    var player = players.get(id);
    if (player == null || !player.status.equals("ACTIVE")) return;
    player.input.clear();
    player.game.physics().cancelInput();
    player.status = "DNF";
    player.endedAt = millis(now);
  }

  void finish(String reason, Instant now) {
    if (startedAt == null || endedAt != null) return;
    this.reason = reason;
    items.clear();
    endedAt = millis(now);
    for (var player : players.values()) {
      player.input.clear();
      player.game.physics().cancelInput();
      if (player.status.equals("ACTIVE")) player.status = "UNFINISHED";
      if (player.endedAt == null) player.endedAt = endedAt;
    }
    var scores = players.values().stream().map(Player::score).toList();
    for (var result : RoomRanking.rank(scores, settings.timeLimitMinutes() != null)) {
      var player = players.get(result.score().playerId());
      player.rank = result.rank();
    }
  }

  RoomRuns.Write write(long revision) {
    var runs =
        players.values().stream()
            .map(
                player -> {
                  var pose = player.game.physics().snapshot();
                  return new RoomRuns.Run(
                      player.runId,
                      player.spec.owner,
                      player.status,
                      pose.ticks,
                      pose.jumps,
                      pose.falls,
                      player.currentProgress,
                      player.maximum,
                      player.peak,
                      player.finish,
                      player.rank,
                      player.endedAt);
                })
            .toList();
    return new RoomRuns.Write(
        id,
        roomId,
        settings.mode(),
        settings.timeLimitMinutes(),
        settings.mapId(),
        settings.itemCooldownMinutes(),
        revision,
        startedAt,
        endedAt,
        ticks,
        reason,
        runs);
  }

  Map<String, Object> results() {
    var rows =
        players.values().stream()
            .sorted(
                Comparator.comparingInt(
                        (Player player) -> player.rank == null ? Integer.MAX_VALUE : player.rank)
                    .thenComparing(player -> player.spec.playerId))
            .map(
                player -> {
                  var row = new LinkedHashMap<String, Object>();
                  row.put("playerId", player.spec.playerId);
                  row.put("nickname", player.spec.nickname);
                  row.put("status", player.status);
                  row.put("rank", player.rank);
                  row.put("currentProgress", player.currentProgress);
                  row.put("maxProgress", player.maximum);
                  row.put("finishTimeMs", player.finish == null ? null : ms(player.finish));
                  return row;
                })
            .toList();
    return Map.of(
        "playId",
        id,
        "reason",
        reason,
        "mapId",
        settings.mapId(),
        "durationMs",
        ms(ticks),
        "results",
        rows,
        "saveStatus",
        saveStatus);
  }

  List<jumpking.dto.PlayerStanding> standings(Set<String> members) {
    var scores =
        players.values().stream()
            .filter(player -> members.contains(player.spec.playerId))
            .map(Player::score)
            .toList();
    return RoomRanking.rank(scores, settings.timeLimitMinutes() != null).stream()
        .map(
            row -> {
              var spec = players.get(row.score().playerId()).spec;
              return new jumpking.dto.PlayerStanding(
                  spec.playerId,
                  spec.nickname,
                  spec.color,
                  row.rank(),
                  row.score().currentProgress());
            })
        .toList();
  }

  long ms(long ticks) {
    return ticks / tickRate * 1000 + ticks % tickRate * 1000 / tickRate;
  }

  Long remainingMs() {
    return limitTicks == 0 ? null : ms(Math.max(0, limitTicks - ticks));
  }

  private static Instant millis(Instant value) {
    return value.truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
  }
}
