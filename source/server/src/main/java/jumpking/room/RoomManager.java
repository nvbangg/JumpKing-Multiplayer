package jumpking.room;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import jumpking.config.FeatureFlags;
import jumpking.config.NetworkSettings;
import jumpking.entity.Crown;
import jumpking.exception.ApiException;
import jumpking.game.SharedData;
import jumpking.network.*;
import jumpking.security.SessionAuthority;
import jumpking.service.CheckpointWriter;
import jumpking.service.PersistenceWorkers;
import jumpking.service.RoomRuns;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Mỗi Room sở hữu một actor; registry chỉ giữ chỗ và không thực hiện I/O. */
@Component
public class RoomManager implements GameCommandHandler, AutoCloseable {
  private static final Set<String> COMMANDS =
      Set.of(
          "CREATE_ROOM",
          "JOIN_ROOM",
          "GET_ROOM_STATE",
          "LEAVE_ROOM",
          "UPDATE_ROOM_SETTINGS",
          "SET_ROOM_CONFIRMED",
          "KICK_PLAYER",
          "RECONNECT",
          "CHAT_SEND",
          "START_GAME",
          "GAME_READY",
          "END_MATCH",
          "SET_ROOM_PAUSED",
          "PLAY_AGAIN",
          "PLAYER_INPUT",
          "CANCEL_INPUT",
          "SET_SPECTATE",
          "USE_ITEM");
  private final RoomDirectory directory;
  private final Memberships memberships;
  private final GameWorkers workers;
  private final NetworkSettings limits;
  private final SessionAuthority sessions;
  private final MonotonicTime time;
  private final ObjectMapper json;
  private final JsonNode rules;
  private final Clock clock;
  private final SharedData shared;
  private final FeatureFlags flags;
  private final PersistenceWorkers database;
  private final jumpking.service.CrownService crowns;
  private final RoomRuns records;
  private final long saveIntervalNs;
  private final Map<String, Room> rooms = new ConcurrentHashMap<>();
  private final ScheduledExecutorService scheduler =
      Executors.newSingleThreadScheduledExecutor(
          Thread.ofPlatform().daemon().name("room-clock").factory());

  public RoomManager(
      RoomDirectory directory,
      Memberships memberships,
      GameWorkers workers,
      NetworkSettings limits,
      SessionAuthority sessions,
      MonotonicTime time,
      ObjectMapper json,
      SharedData shared,
      Clock clock,
      FeatureFlags flags,
      PersistenceWorkers database,
      RoomRuns records,
      jumpking.service.CrownService crowns,
      @Value("${app.checkpoint-interval-ms:1000}") long saveIntervalMs) {
    this.directory = directory;
    this.memberships = memberships;
    this.workers = workers;
    this.limits = limits;
    this.sessions = sessions;
    this.time = time;
    this.json = json;
    rules = shared.rules();
    this.clock = clock;
    this.shared = shared;
    this.flags = flags;
    this.database = database;
    this.records = records;
    this.crowns = crowns;
    saveIntervalNs = saveIntervalMs * 1_000_000L;
    if (saveIntervalMs < 1)
      throw new IllegalArgumentException("Room save interval must be positive");
  }

  private final class Member {
    final String id = UUID.randomUUID().toString(), token = token();
    final GameConnection.Identity identity;
    final RoomDirectory.Slot slot;
    final String nickname;
    final long order;
    GameConnection connection;
    String watching;
    boolean confirmed = true, nextMatchJoined = true;
    Crown crown = Crown.NONE;
    long disconnectedAt, generation;

    Member(GameConnection connection, RoomDirectory.Slot slot, String nickname, long order) {
      this.connection = connection;
      identity = connection.identity();
      this.slot = slot;
      this.nickname = nickname;
      this.order = order;
    }
  }

  private final class Room {
    final String id;
    final LinkedHashMap<String, Member> players = new LinkedHashMap<>();
    final ChatLog chat =
        new ChatLog(
            clock, time, limits.chatCodePoints(), limits.chatHistory(), limits.chatIntervalMs());
    final SerialExecutor actor;
    final ScheduledFuture<?> timer;
    RoomSettings settings = RoomSettings.defaults();
    String state = "WAITING", visibility = "PUBLIC";
    RoomMatch match;
    CheckpointWriter<RoomRuns.Write> writer;
    long prepareDeadline, countdownAt, nextTick, serverTick, lastSnapshotTick, eventSeq, lastSave;
    boolean retired;
    final AtomicBoolean tickQueued = new AtomicBoolean();
    String host;
    long joinOrder;

    Room(String id) {
      this.id = id;
      actor =
          new SerialExecutor(
              workers.executor(),
              limits.commandQueue(),
              database.completionCapacity(rules.path("roomCapacity").asInt()),
              error ->
                  players
                      .values()
                      .forEach(
                          player -> {
                            if (player.connection != null)
                              player.connection.close(
                                  org.springframework.web.socket.CloseStatus.SERVER_ERROR);
                          }));
      timer =
          scheduler.scheduleAtFixedRate(
              () -> {
                if (!tickQueued.compareAndSet(false, true)) return;
                try {
                  actor.execute(
                      () -> {
                        try {
                          advance(this);
                        } finally {
                          tickQueued.set(false);
                        }
                      });
                } catch (RejectedExecutionException busy) {
                  tickQueued.set(false);
                }
              },
              0,
              1_000_000_000L / shared.tuning().tickRate,
              TimeUnit.NANOSECONDS);
    }
  }

  @Override
  public boolean supports(GameConnection connection, GameEnvelope command) {
    if (!COMMANDS.contains(command.type())) return false;
    if (command.type().equals("CREATE_ROOM")) return true;
    if (command.type().equals("JOIN_ROOM") || command.type().equals("RECONNECT")) {
      var info = directory.find(command.payload().path("roomId").asText());
      return info != null && info.kind().equals("ROOM");
    }
    var membership = memberships.find(connection.identity().owner());
    return membership != null && rooms.containsKey(membership.roomId());
  }

  @Override
  public void handle(GameConnection connection, GameEnvelope command) {
    if (command.type().equals("CREATE_ROOM") || command.type().equals("JOIN_ROOM")) {
      join(connection, command);
      return;
    }
    var membership = memberships.find(connection.identity().owner());
    var room = membership == null ? null : rooms.get(membership.roomId());
    if (room == null && command.type().equals("RECONNECT"))
      throw new ApiException(409, "RECONNECT_EXPIRED", "Reconnect is no longer available");
    if (room == null) throw new ApiException(404, "ROOM_NOT_FOUND", "Room not found");
    room.actor.execute(
        () ->
            safely(
                connection,
                command,
                () -> {
                  var player = room.players.get(membership.playerId());
                  if (player == null && command.type().equals("RECONNECT"))
                    throw new ApiException(
                        409, "RECONNECT_EXPIRED", "Reconnect is no longer available");
                  if (player == null)
                    throw new ApiException(409, "CONFLICT", "Room join is still in progress");
                  if (command.type().equals("RECONNECT")) {
                    reconnect(room, player, connection, command);
                    return;
                  }
                  if (player.connection != connection)
                    throw new ApiException(
                        409, "INVALID_RECONNECT", "Reconnect with your saved token");
                  switch (command.type()) {
                    case "GET_ROOM_STATE" -> {
                      GameEnvelope.fields(command.payload(), Set.of());
                      connection.reply(command, "ROOM_STATE", state(room));
                    }
                    case "LEAVE_ROOM" -> {
                      GameEnvelope.fields(command.payload(), Set.of());
                      remove(room, player, command);
                    }
                    case "UPDATE_ROOM_SETTINGS" -> {
                      if (!player.id.equals(room.host))
                        throw new ApiException(
                            403, "FORBIDDEN", "Only the Host can change settings");
                      if (!room.state.equals("WAITING"))
                        throw new ApiException(
                            409, "CONFLICT", "Settings can only change in the Lobby");
                      GameEnvelope.fields(
                          command.payload(),
                          Set.of(
                              "mode",
                              "timeLimitMinutes",
                              "mapId",
                              "visibility",
                              "itemCooldownMinutes"));
                      if (command.payload().isEmpty()) throw GameEnvelope.invalid();
                      var settingsInput = ((ObjectNode) command.payload()).deepCopy();
                      settingsInput.remove("visibility");
                      if (!settingsInput.isEmpty()) {
                        if (!settingsInput.has("itemCooldownMinutes"))
                          settingsInput.set(
                              "itemCooldownMinutes",
                              json.valueToTree(room.settings.itemCooldownMinutes()));
                        if (!settingsInput.has("mapId"))
                          settingsInput.put("mapId", room.settings.mapId());
                        if (!settingsInput.has("mode"))
                          settingsInput.put("mode", room.settings.mode());
                        if (!settingsInput.has("timeLimitMinutes"))
                          settingsInput.set(
                              "timeLimitMinutes",
                              json.valueToTree(room.settings.timeLimitMinutes()));
                      }
                      var settings =
                          settingsInput.isEmpty()
                              ? room.settings
                              : RoomSettings.parse(settingsInput, rules);
                      String visibility =
                          command.payload().has("visibility")
                              ? visibility(command.payload())
                              : room.visibility;
                      room.settings = settings;
                      room.visibility = visibility;
                      directory.describeRoom(room.id, visibility, settings);
                      connection.reply(command, "ROOM_STATE", state(room));
                      broadcast(room);
                    }
                    case "SET_ROOM_CONFIRMED" -> {
                      GameEnvelope.fields(command.payload(), Set.of("confirmed"));
                      if (!room.state.equals("WAITING") || !player.nextMatchJoined)
                        throw new ApiException(
                            409, "CONFLICT", "Confirmation can only change in the Lobby");
                      player.confirmed = GameEnvelope.bool(command.payload(), "confirmed", false);
                      connection.reply(command, "ROOM_STATE", state(room));
                      broadcast(room);
                    }
                    case "KICK_PLAYER" -> {
                      GameEnvelope.fields(command.payload(), Set.of("playerId"));
                      requireHost(room, player);
                      if (!room.state.equals("WAITING"))
                        throw new ApiException(
                            409, "CONFLICT", "Players can only be kicked in the Lobby");
                      String targetId = GameEnvelope.text(command.payload(), "playerId");
                      var target = room.players.get(targetId);
                      if (target == null || target == player)
                        throw new ApiException(409, "CONFLICT", "Choose another Room member");
                      remove(room, target, null, "KICKED");
                      connection.reply(command, "ROOM_STATE", state(room));
                    }
                    case "START_GAME" -> {
                      GameEnvelope.fields(command.payload(), Set.of());
                      start(room, player);
                      connection.reply(command, "ROOM_STATE", state(room));
                    }
                    case "GAME_READY" -> {
                      GameEnvelope.fields(command.payload(), Set.of("playId", "generation"));
                      if (!Set.of("COUNTDOWN", "PLAYING").contains(room.state)
                          || room.match == null
                          || !room.match.id.equals(GameEnvelope.text(command.payload(), "playId"))
                          || GameEnvelope.integer(command.payload(), "generation")
                              != player.generation)
                        throw new ApiException(
                            409, "STALE_PLAY", "Loading acknowledgement belongs to an old match");
                      if (room.state.equals("COUNTDOWN")
                          && room.countdownAt == 0
                          && player.id.equals(room.host))
                        room.countdownAt =
                            time.nanos() + rules.path("countdownMs").asLong() * 1_000_000L;
                      connection.reply(command, "ROOM_STATE", state(room));
                      broadcast(room);
                    }
                    case "PLAY_AGAIN" -> {
                      GameEnvelope.fields(command.payload(), Set.of("matchId"));
                      if (room.match == null
                          || !room.match.id.equals(GameEnvelope.text(command.payload(), "matchId")))
                        throw new ApiException(
                            409, "STALE_PLAY", "Confirmation belongs to an old match");
                      if (!Set.of("FINISHED", "WAITING").contains(room.state)
                          || room.match.endedAt == null)
                        throw new ApiException(409, "CONFLICT", "The match has not ended");
                      if (room.match.saveStatus.equals("FAILED")) save(room, true);
                      if (room.match.saveStatus.equals("SAVED")) {
                        player.confirmed = true;
                        player.nextMatchJoined = true;
                        room.state = "WAITING";
                        directory.joinable(room.id, true);
                      }
                      connection.reply(command, "ROOM_STATE", state(room));
                      broadcast(room);
                    }
                    case "END_MATCH" -> {
                      GameEnvelope.fields(command.payload(), Set.of());
                      requireHost(room, player);
                      if (!Set.of("PLAYING", "PAUSED").contains(room.state))
                        throw new ApiException(409, "CONFLICT", "No running match to end");
                      room.match.finish("HOST_ENDED", clock.instant());
                      finish(room);
                      connection.reply(command, "GAME_FINISHED", room.match.results());
                    }
                    case "SET_ROOM_PAUSED" -> {
                      GameEnvelope.fields(command.payload(), Set.of("paused"));
                      requireHost(room, player);
                      boolean paused = GameEnvelope.bool(command.payload(), "paused", false);
                      if (!room.state.equals(paused ? "PLAYING" : "PAUSED"))
                        throw new ApiException(
                            409,
                            "CONFLICT",
                            paused
                                ? "Match can only be paused while playing"
                                : "Match is not paused");
                      room.state = paused ? "PAUSED" : "PLAYING";
                      if (!paused)
                        room.nextTick = time.nanos() + 1_000_000_000L / room.match.tickRate;
                      for (var member : room.players.values()) {
                        var racer = room.match.players.get(member.id);
                        if (racer != null) {
                          racer.input.clear();
                          if (paused) racer.game.physics().cancelInput();
                        }
                      }
                      connection.reply(command, "ROOM_STATE", state(room));
                      broadcast(room);
                      snapshots(room);
                    }
                    case "SET_SPECTATE" -> {
                      GameEnvelope.fields(command.payload(), Set.of("playerId"));
                      if (!command.payload().has("playerId")) throw GameEnvelope.invalid();
                      String targetId =
                          command.payload().path("playerId").isNull()
                              ? null
                              : GameEnvelope.text(command.payload(), "playerId");
                      var target = targetId == null ? null : room.players.get(targetId);
                      if (targetId != null
                          && (!Set.of("PLAYING", "PAUSED").contains(room.state)
                              || target == null
                              || target == player
                              || target.connection == null
                              || !target.connection.open()
                              || !room.match.players.containsKey(targetId)
                              || !room.match.players.get(targetId).status.equals("ACTIVE")))
                        throw new ApiException(
                            409,
                            "INVALID_SPECTATE_TARGET",
                            "Player is no longer available to watch");
                      var racer = room.match == null ? null : room.match.players.get(player.id);
                      if (racer != null) {
                        racer.input.clear();
                        racer.game.physics().cancelInput();
                      }
                      player.watching = targetId;
                      connection.reply(
                          command,
                          "SPECTATE_STATE",
                          json.createObjectNode().put("roomId", room.id).put("playerId", targetId));
                      snapshots(room);
                    }
                    case "USE_ITEM" -> {
                      GameEnvelope.fields(command.payload(), Set.of("playId", "generation"));
                      if (room.match == null
                          || !room.match.id.equals(GameEnvelope.text(command.payload(), "playId"))
                          || player.generation
                              != GameEnvelope.integer(command.payload(), "generation"))
                        throw new ApiException(409, "STALE_PLAY", "Item belongs to an old match");
                      var racer = room.match.players.get(player.id);
                      if (!room.state.equals("PLAYING")
                          || racer == null
                          || !racer.status.equals("ACTIVE")
                          || player.watching != null
                          || room.match.settings.itemCooldownMinutes() == null)
                        throw new ApiException(409, "ITEM_UNAVAILABLE", "Items are unavailable");
                      var connected =
                          room.players.values().stream()
                              .filter(m -> m.connection != null && m.connection.open())
                              .map(m -> m.id)
                              .collect(java.util.stream.Collectors.toSet());
                      room.match.useItem(player.id, connected);
                      connection.reply(
                          command, "ITEM_USED", Map.of("roomId", room.id, "playId", room.match.id));
                      snapshots(room);
                    }
                    case "PLAYER_INPUT", "CANCEL_INPUT" -> {
                      var racer = room.match == null ? null : room.match.players.get(player.id);
                      if (racer == null)
                        throw new ApiException(409, "STALE_PLAY", "No current play context");
                      racer.input.offer(command, time.nanos(), flags.flyEnabled());
                      if (!room.state.equals("PLAYING")
                          || !racer.status.equals("ACTIVE")
                          || player.watching != null) racer.input.clear();
                      else if (command.type().equals("CANCEL_INPUT"))
                        racer.game.physics().cancelInput();
                    }
                    case "CHAT_SEND" -> {
                      GameEnvelope.fields(command.payload(), Set.of("text"));
                      var message =
                          room.chat.send(
                              player.id,
                              player.nickname,
                              player.slot.color(),
                              GameEnvelope.text(command.payload(), "text"));
                      var payload = Map.of("roomId", room.id, "messages", List.of(message));
                      connection.reply(command, "CHAT_MESSAGE", payload);
                      for (var peer : room.players.values())
                        if (peer != player && peer.connection != null)
                          peer.connection.send("CHAT_MESSAGE", payload);
                    }
                    default -> throw GameEnvelope.invalid();
                  }
                }));
  }

  private synchronized void join(GameConnection connection, GameEnvelope command) {
    boolean create = command.type().equals("CREATE_ROOM");
    if (!connection.identity().account())
      throw new ApiException(401, "AUTH_REQUIRED", "Sign in to play Room");
    GameEnvelope.fields(command.payload(), create ? Set.of("settings") : Set.of("roomId"));
    String nickname = connection.identity().username();
    var settings =
        create && command.payload().has("settings")
            ? RoomSettings.parse(command.payload().get("settings"), rules)
            : RoomSettings.defaults();
    if (memberships.find(connection.identity().owner()) != null)
      throw new ApiException(409, "ALREADY_IN_ROOM", "Leave your current room first");
    var slot =
        create
            ? directory.createRoom()
            : directory.room(GameEnvelope.text(command.payload(), "roomId"));
    try {
      var room = rooms.computeIfAbsent(slot.roomId(), Room::new);
      var player = new Member(connection, slot, nickname, ++room.joinOrder);
      // Giữ quota và identity khi chờ DB; chỉ đưa player vào roster sau callback.
      memberships.claim(player.identity.owner(), new Memberships.Membership(room.id, player.id));
      try {
        room.actor.execute(
            () -> {
              try {
                database.execute(() -> loadJoin(room, player, command, create, settings));
              } catch (RejectedExecutionException busy) {
                rejectJoin(
                    room,
                    player,
                    command,
                    new ApiException(429, "RATE_LIMITED", "Server is busy; try joining again"));
              }
            });
      } catch (RejectedExecutionException busy) {
        room.actor.complete(
            () ->
                rejectJoin(
                    room,
                    player,
                    command,
                    new ApiException(429, "RATE_LIMITED", "Server is busy; try joining again")));
      }
    } catch (RuntimeException error) {
      if (directory.release(slot)) {
        var room = rooms.remove(slot.roomId());
        if (room != null) room.timer.cancel(false);
      }
      throw error;
    }
  }

  private void loadJoin(
      Room room, Member player, GameEnvelope command, boolean create, RoomSettings settings) {
    if (!player.connection.open()) {
      room.actor.complete(
          () ->
              rejectJoin(
                  room,
                  player,
                  command,
                  new ApiException(409, "CONFLICT", "Connection closed before joining")));
      return;
    }
    try {
      var crown = crowns.crown(player.identity.owner());
      room.actor.complete(() -> completeJoin(room, player, command, create, settings, crown));
    } catch (Exception error) {
      room.actor.complete(
          () ->
              rejectJoin(
                  room,
                  player,
                  command,
                  new ApiException(503, "INTERNAL_ERROR", "Unable to load player account")));
    }
  }

  private void completeJoin(
      Room room,
      Member player,
      GameEnvelope command,
      boolean create,
      RoomSettings settings,
      Crown crown) {
    if (rooms.get(room.id) != room
        || !room.state.equals("WAITING")
        || !player.connection.open()
        || !new Memberships.Membership(room.id, player.id)
            .equals(memberships.find(player.identity.owner()))) {
      rejectJoin(
          room,
          player,
          command,
          new ApiException(409, "ROOM_NOT_JOINABLE", "This room is not accepting new players"));
      return;
    }
    player.crown = crown;
    if (create) {
      room.settings = settings;
      room.visibility = "PUBLIC";
      directory.describeRoom(room.id, room.visibility, settings);
    }
    room.players.put(player.id, player);
    chooseHost(room);
    if (player.identity.sessionId() != null) sessions.touch(player.identity.sessionId());
    player.connection.reply(command, "ROOM_JOINED", joined(room, player));
    broadcast(room);
    chatHistory(room, player);
  }

  private void rejectJoin(Room room, Member player, GameEnvelope command, ApiException error) {
    var membership = new Memberships.Membership(room.id, player.id);
    if (!membership.equals(memberships.find(player.identity.owner()))) return;
    memberships.release(player.identity.owner(), membership);
    releaseSlot(room, player.slot);
    player.connection.error(command, error);
  }

  private String visibility(JsonNode payload) {
    String value = payload.has("visibility") ? GameEnvelope.text(payload, "visibility") : "PUBLIC";
    if (!Set.of("PRIVATE", "PUBLIC").contains(value)) throw GameEnvelope.invalid();
    return value;
  }

  private void reconnect(
      Room room, Member player, GameConnection connection, GameEnvelope command) {
    GameEnvelope.fields(command.payload(), Set.of("roomId", "playerId", "reconnectToken"));
    if (!room.id.equals(GameEnvelope.text(command.payload(), "roomId"))
        || !player.id.equals(GameEnvelope.text(command.payload(), "playerId"))
        || !MessageDigest.isEqual(
            player.token.getBytes(java.nio.charset.StandardCharsets.UTF_8),
            GameEnvelope.text(command.payload(), "reconnectToken")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)))
      throw new ApiException(403, "INVALID_RECONNECT", "Invalid reconnect context");
    if (player.connection == null
        && time.nanos() - player.disconnectedAt >= rules.path("reconnectMs").asLong() * 1_000_000L)
      throw new ApiException(409, "RECONNECT_EXPIRED", "Reconnect is no longer available");
    player.watching = null;
    var old = player.connection;
    player.connection = connection;
    player.generation++;
    chooseHost(room);
    if (old != null && old != connection)
      old.close(org.springframework.web.socket.CloseStatus.NORMAL);
    if (room.match != null && room.match.players.containsKey(player.id))
      room.match.players.get(player.id).input.reset(room.match.id, player.generation);
    room.nextTick = time.nanos();
    connection.reply(command, "RECONNECT_OK", context(room, player));
    broadcast(room);
    chatHistory(room, player);
    snapshots(room);
  }

  private void chooseHost(Room room) {
    var old = room.host == null ? null : room.players.get(room.host);
    if (old != null && old.connection != null) return;
    room.host =
        room.players.values().stream()
            .filter(player -> player.connection != null)
            .min(Comparator.comparingLong(player -> player.order))
            .map(player -> player.id)
            .orElse(null);
  }

  private void remove(Room room, Member player, GameEnvelope command) {
    remove(room, player, command, null);
  }

  private void remove(Room room, Member player, GameEnvelope command, String reason) {
    if (room.state.equals("COUNTDOWN")) cancelCountdown(room);
    if (room.match != null && room.match.startedAt != null && room.match.endedAt == null)
      room.match.abandon(player.id, clock.instant());
    if (room.players.remove(player.id) == null) return;
    room.chat.leave(player.id);
    memberships.release(player.identity.owner(), new Memberships.Membership(room.id, player.id));
    if (player.connection != null) {
      var payload = json.createObjectNode().put("roomId", room.id);
      if (reason != null) payload.put("reason", reason);
      if (command == null) player.connection.send("ROOM_LEFT", payload);
      else player.connection.reply(command, "ROOM_LEFT", payload);
    }
    releaseSlot(room, player.slot);
  }

  private void releaseSlot(Room room, RoomDirectory.Slot slot) {
    boolean retain =
        room.players.isEmpty()
            && room.match != null
            && room.match.startedAt != null
            && (room.match.endedAt == null || !room.match.saveStatus.equals("SAVED"));
    boolean empty = directory.release(slot, retain);
    room.retired = empty && retain;
    if (room.retired) {
      room.host = null;
      directory.joinable(room.id, false);
    }
    if (room.match != null && room.match.startedAt != null && room.match.endedAt == null) {
      if (empty) {
        room.match.finish("ALL_DISCONNECTED", clock.instant());
        finish(room);
      } else save(room, true);
    }
    if (empty && !room.retired) dispose(room);
    else {
      chooseHost(room);
      broadcast(room);
      snapshots(room);
    }
  }

  private ObjectNode context(Room room, Member player) {
    var result =
        json.createObjectNode()
            .put("roomId", room.id)
            .put("playerId", player.id)
            .put("generation", player.generation);
    if (room.match == null) result.putNull("playId");
    else result.put("playId", room.match.id);
    return result;
  }

  private ObjectNode joined(Room room, Member player) {
    return context(room, player).put("kind", "ROOM").put("reconnectToken", player.token);
  }

  private ObjectNode state(Room room) {
    var state =
        json.createObjectNode()
            .put("roomId", room.id)
            .put("kind", "ROOM")
            .put("state", room.state)
            .put("visibility", room.visibility);
    if (room.host == null) state.putNull("hostPlayerId");
    else state.put("hostPlayerId", room.host);
    state.set("settings", json.valueToTree(room.settings));
    for (String field : List.of("currentPlay", "result")) state.putNull(field);
    if (room.match != null) {
      state
          .putObject("currentPlay")
          .put("id", room.match.id)
          .put("elapsedTimeMs", room.match.ms(room.match.ticks))
          .put(
              "countdownRemainingMs",
              room.state.equals("COUNTDOWN") && room.countdownAt > 0
                  ? Math.max(0, (room.countdownAt - time.nanos()) / 1_000_000L)
                  : 0);
      if (room.match.endedAt != null) state.set("result", json.valueToTree(room.match.results()));
    }
    var members = state.putArray("members");
    for (var player : room.players.values()) {
      members
          .addObject()
          .put("playerId", player.id)
          .put("nickname", player.nickname)
          .put("colorSlot", player.slot.color())
          .put("connected", player.connection != null)
          .putNull("paused")
          .put("nextMatchConfirmed", player.confirmed)
          .put("nextMatchJoined", player.nextMatchJoined);
    }
    return state;
  }

  private void broadcast(Room room) {
    var payload = state(room);
    for (var player : room.players.values())
      if (player.connection != null) player.connection.send("ROOM_STATE", payload);
  }

  private void chatHistory(Room room, Member player) {
    if (player.connection != null)
      player.connection.send(
          "CHAT_HISTORY", room.chat.history(room.id, json, limits.messageBytes()));
  }

  private void safely(GameConnection connection, GameEnvelope command, Runnable action) {
    if (!connection.open()) return;
    try {
      action.run();
      if (connection.identity().sessionId() != null)
        sessions.touch(connection.identity().sessionId());
    } catch (ApiException error) {
      connection.error(command, error);
    } catch (Exception error) {
      connection.error(
          command, new ApiException(500, "INTERNAL_ERROR", "Unable to process Room command"));
    }
  }

  @Override
  public void disconnected(GameConnection connection) {
    var membership = memberships.find(connection.identity().owner());
    var room = membership == null ? null : rooms.get(membership.roomId());
    if (room == null) return;
    try {
      room.actor.complete(
          () -> {
            var player = room.players.get(membership.playerId());
            if (player == null || player.connection != connection) return;
            dropConnection(room, player);
          });
    } catch (RejectedExecutionException busy) {
      connection.close(org.springframework.web.socket.CloseStatus.SERVICE_OVERLOAD);
    }
  }

  private void dropConnection(Room room, Member player) {
    player.watching = null;
    if (room.state.equals("COUNTDOWN")) cancelCountdown(room);
    if (room.match != null && room.match.players.containsKey(player.id)) {
      var racer = room.match.players.get(player.id);
      racer.input.clear();
      racer.game.physics().cancelInput();
    }
    player.connection = null;
    player.disconnectedAt = time.nanos();
    chooseHost(room);
    broadcast(room);
    if (Set.of("PLAYING", "PAUSED").contains(room.state)
        && room.players.values().stream().noneMatch(member -> member.connection != null))
      save(room, true);
  }

  private void requireHost(Room room, Member player) {
    if (!player.id.equals(room.host))
      throw new ApiException(403, "FORBIDDEN", "Only the Host can perform this action");
  }

  private void start(Room room, Member host) {
    requireHost(room, host);
    if (!room.state.equals("WAITING"))
      throw new ApiException(409, "CONFLICT", "The Room is not waiting for a match");
    var roster =
        room.players.values().stream()
            .filter(player -> player.connection != null && player.confirmed)
            .toList();
    if (!host.confirmed || roster.size() < rules.path("minimumRoomPlayers").asInt())
      throw new ApiException(
          409, "NOT_ENOUGH_PLAYERS", "The connected Host must confirm before starting");
    if (room.players.values().stream()
        .anyMatch(
            player -> player.connection != null && player.nextMatchJoined && !player.confirmed))
      throw new ApiException(
          409, "CONFLICT", "All connected Lobby players must confirm before starting");
    if (room.match != null && room.match.endedAt != null && !room.match.saveStatus.equals("SAVED"))
      throw new ApiException(409, "SAVE_PENDING", "Wait for the previous results to be saved");
    for (var player : List.copyOf(room.players.values()))
      if (!roster.contains(player)) remove(room, player, null);
    var specs =
        roster.stream()
            .map(
                player ->
                    new RoomMatch.Spec(
                        player.id,
                        player.identity.owner(),
                        player.nickname,
                        player.slot.color(),
                        ++player.generation))
            .toList();
    room.match = new RoomMatch(room.id, room.settings, specs, shared, limits, flags.flyEnabled());
    room.writer = database.writer(records::save);
    for (var player : roster)
      if (player.crown != Crown.NONE) room.match.players.get(player.id).game.adventure().complete();
    room.state = "COUNTDOWN";
    room.countdownAt = 0;
    room.prepareDeadline = time.nanos() + rules.path("roomLoadTimeoutMs").asLong() * 1_000_000L;
    directory.joinable(room.id, false);
    for (var player : roster)
      player.connection.send(
          "GAME_STARTED",
          Map.of(
              "playId",
              room.match.id,
              "generation",
              player.generation,
              "countdownMs",
              rules.path("countdownMs").asLong()));
    broadcast(room);
  }

  private void cancelCountdown(Room room) {
    if (!room.state.equals("COUNTDOWN")) return;
    room.state = "WAITING";
    room.match = null;
    room.writer = null;
    directory.joinable(room.id, true);
  }

  private void advance(Room room) {
    long now = time.nanos();
    if (room.retired) {
      if (room.match.saveStatus.equals("SAVED")) dispose(room);
      else if (room.match.saveStatus.equals("FAILED") && now - room.lastSave >= saveIntervalNs)
        save(room, true);
      return;
    }
    for (var player : List.copyOf(room.players.values()))
      if (player.connection != null && !player.connection.open()) dropConnection(room, player);
    for (var player : List.copyOf(room.players.values()))
      if (player.connection == null
          && now - player.disconnectedAt >= rules.path("reconnectMs").asLong() * 1_000_000L)
        remove(room, player, null);
    if (room.state.equals("COUNTDOWN") && room.countdownAt == 0 && now >= room.prepareDeadline) {
      cancelCountdown(room);
      broadcast(room);
    }
    if (room.state.equals("COUNTDOWN") && room.countdownAt > 0 && now >= room.countdownAt) {
      room.match.start(clock.instant());
      room.state = "PLAYING";
      room.nextTick = now;
      save(room, true);
      broadcast(room);
      snapshots(room);
    }
    if (!room.state.equals("PLAYING")) return;
    for (var member : room.players.values()) {
      var racer = room.match.players.get(member.id);
      if (member.connection != null && racer != null && racer.input.requiresResync(now)) {
        member.connection.close(
            new org.springframework.web.socket.CloseStatus(
                1013, "Input backlog; reconnect to resync"));
        dropConnection(room, member);
      }
    }
    long step = 1_000_000_000L / room.match.tickRate;
    if (room.players.values().stream().noneMatch(player -> player.connection != null)) {
      room.nextTick = now + step;
      return;
    }
    int steps = 0;
    // Giữ nợ tick cho lượt actor sau để input FIFO không chậm dần sau gián đoạn.
    while (now >= room.nextTick && steps++ < 5 && room.state.equals("PLAYING")) {
      room.nextTick += step;
      room.serverTick++;
      emit(room, room.match.tick(now, clock.instant()));
      if (room.match.endedAt != null) {
        finish(room);
        break;
      }
      if (room.match.ticks % (room.match.tickRate / rules.path("snapshotRate").asInt()) == 0)
        snapshots(room);
    }
    if (room.state.equals("PLAYING") && now - room.lastSave >= saveIntervalNs) save(room, false);
  }

  private void finish(Room room) {
    room.players
        .values()
        .forEach(
            player -> {
              player.confirmed = false;
              player.nextMatchJoined = false;
            });
    room.state = "FINISHED";
    directory.joinable(room.id, false);
    save(room, true);
    var result = room.match.results();
    for (var player : room.players.values())
      if (player.connection != null) player.connection.send("GAME_FINISHED", result);
    broadcast(room);
    snapshots(room);
  }

  private void save(Room room, boolean barrier) {
    var match = room.match;
    if (match == null || match.startedAt == null) return;
    if (match.terminalWrite != null && !match.saveStatus.equals("FAILED")) return;
    var value = match.terminalWrite == null ? match.write(++match.revision) : match.terminalWrite;
    if (match.endedAt != null) match.terminalWrite = value;
    match.saveStatus = "PENDING";
    room.lastSave = time.nanos();
    try {
      room.writer.submit(
          value,
          barrier,
          (outcome, error) -> {
            if (outcome == CheckpointWriter.Outcome.RETRYING) return;
            room.actor.complete(
                () -> {
                  if (outcome == CheckpointWriter.Outcome.SAVED)
                    match.savedRevision = Math.max(match.savedRevision, value.revision());
                  match.saveStatus =
                      outcome == CheckpointWriter.Outcome.FAILED
                          ? "FAILED"
                          : match.savedRevision >= match.revision ? "SAVED" : "PENDING";
                  if (match.endedAt != null && match.saveStatus.equals("SAVED")) {
                    match.durable.complete(null);
                    if (room.retired) dispose(room);
                  }
                  var status =
                      json.createObjectNode()
                          .put("playId", match.id)
                          .putNull("revision")
                          .put("saveStatus", match.saveStatus);
                  for (var player : room.players.values())
                    if (player.connection != null) player.connection.send("SAVE_STATUS", status);
                  if (room.match == match) broadcast(room);
                });
          });
    } catch (RejectedExecutionException busy) {
      match.saveStatus = "FAILED";
      for (var player : room.players.values())
        if (player.connection != null)
          player.connection.send(
              "ERROR", Map.of("code", "SAVE_FAILED", "message", "Room results could not be saved"));
    }
  }

  private void emit(Room room, List<RoomMatch.Events> events) {
    var effects = json.createArrayNode();
    for (var event : events) {
      var player = event.player();
      if (!event.effects().movement().isEmpty()) {
        var pose = player.game.physics().snapshot();
        for (var effect : event.effects().movement())
          effects
              .addObject()
              .put("eventSeq", ++room.eventSeq)
              .put("playerId", player.spec.playerId())
              .put("playId", room.match.id)
              .put("screen", pose.screen)
              .put("effect", effect)
              .put("terrain", pose.snow ? "SNOW" : pose.ice ? "ICE" : "NORMAL");
      }
      var member = room.players.get(player.spec.playerId());
      if (member != null
          && member.connection != null
          && (!event.effects().adventure().isEmpty() || !event.effects().world().isEmpty())) {
        var cues = json.createArrayNode();
        for (var cue : event.effects().adventure())
          cues.addObject()
              .put("eventSeq", ++room.eventSeq)
              .put("kind", "ADVENTURE")
              .put("type", cue.type())
              .put("id", cue.id());
        for (var cue : event.effects().world())
          cues.addObject()
              .put("eventSeq", ++room.eventSeq)
              .put("kind", "WORLD")
              .put("type", cue.type())
              .put("id", cue.id());
        for (var receiver : room.players.values())
          if (receiver.connection != null
              && (receiver.watching == null
                  ? receiver == member
                  : receiver.watching.equals(member.id)))
            receiver.connection.send(
                "ADVENTURE_EVENTS",
                Map.of(
                    "roomId",
                    room.id,
                    "playId",
                    room.match.id,
                    "sourcePlayerId",
                    member.id,
                    "events",
                    cues));
      }
    }
    if (!effects.isEmpty())
      for (var member : room.players.values())
        if (member.connection != null && room.match.players.containsKey(member.id)) {
          var target = member.watching == null ? null : room.match.players.get(member.watching);
          int screen =
              (target == null ? room.match.players.get(member.id) : target)
                  .game
                  .physics()
                  .snapshot()
                  .screen;
          var visible = json.createArrayNode();
          for (var effect : effects)
            if (effect.path("screen").asInt() == screen
                || effect.path("playerId").asText().equals(member.id)) visible.add(effect);
          if (!visible.isEmpty())
            member.connection.send("PLAYER_EFFECTS", Map.of("roomId", room.id, "events", visible));
        }
  }

  private void snapshots(Room room) {
    var match = room.match;
    if (match == null || match.startedAt == null) return;
    if (room.players.values().stream()
        .noneMatch(player -> player.connection != null && player.connection.open())) return;
    // Khi đang chạy, gộp commands cùng tick vào frame kế tiếp thay vì tăng clock.
    if (room.state.equals("PLAYING")
        && match.ticks > 0
        && room.lastSnapshotTick != 0
        && room.serverTick <= room.lastSnapshotTick) return;
    room.serverTick = Math.max(room.serverTick, room.lastSnapshotTick + 1);
    room.lastSnapshotTick = room.serverTick;
    var standings = match.standings(room.players.keySet());
    var captured = new HashMap<String, PlayerSnapshot>();
    for (var other : room.players.values()) {
      var peer = match.players.get(other.id);
      if (peer == null) continue;
      captured.put(
          other.id,
          PlayerSnapshot.capture(
              peer.game, other.id, other.nickname, other.slot.color(), peer.status, other.crown));
    }
    for (var member : room.players.values()) {
      var self = match.players.get(member.id);
      if (member.connection == null || self == null) continue;
      var snapshot =
          json.createObjectNode()
              .put("roomId", room.id)
              .put("serverTick", room.serverTick)
              .put("playId", match.id)
              .put("generation", member.generation)
              .put("elapsedTimeMs", match.ms(match.ticks))
              .put("remainingTimeMs", match.remainingMs());
      snapshot.putPOJO("players", standings);
      var own =
          snapshot
              .putObject("self")
              .put("lastProcessedInputSeq", self.input.processed())
              .put("status", self.status)
              .put("crown", member.crown.name())
              .put("paused", !room.state.equals("PLAYING"));
      own.putPOJO("simulation", captured.get(member.id).simulation());
      var target = member.watching == null ? null : room.players.get(member.watching);
      if (target != null
          && (!Set.of("PLAYING", "PAUSED").contains(room.state)
              || target.connection == null
              || !target.connection.open()
              || !match.players.containsKey(target.id)
              || !match.players.get(target.id).status.equals("ACTIVE"))) target = null;
      if (target == null) member.watching = null;
      var watched = target == null ? null : match.players.get(target.id);
      snapshot.putPOJO(
          "spectating",
          watched == null
              ? null
              : SpectatorView.of(captured.get(target.id), match.id, match.ms(match.ticks), false));
      var peers = snapshot.putArray("peers");
      int screen = captured.get(watched == null ? member.id : target.id).screen();
      captured.forEach(
          (id, saved) -> {
            if (!id.equals(member.id) && Math.abs(saved.screen() - screen) <= 1)
              peers.addPOJO(saved.player());
          });
      if (match.settings.itemCooldownMinutes() != null)
        snapshot.putPOJO(
            "items",
            match.items.view(member.id, match.ticks, screen, shared.geometry().screenHeight()));
      member.connection.snapshot(snapshot);
    }
  }

  private static String token() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private void dispose(Room room) {
    if (rooms.remove(room.id, room)) {
      directory.releaseEmptyRoom(room.id);
      room.timer.cancel(false);
    }
  }

  @Override
  public void close() {
    scheduler.shutdownNow();
    var pending = new ArrayList<CompletableFuture<Void>>();
    for (var room : rooms.values()) {
      var flushed = new CompletableFuture<Void>();
      pending.add(flushed);
      try {
        room.actor.complete(
            () -> {
              if (room.match == null || room.match.startedAt == null) {
                flushed.complete(null);
                return;
              }
              if (room.match.endedAt == null) {
                for (var player : room.match.players.values())
                  room.match.abandon(player.spec.playerId(), clock.instant());
                room.match.finish("ABORTED", clock.instant());
                finish(room);
              } else if (room.match.saveStatus.equals("FAILED")) save(room, true);
              room.match.durable.whenComplete(
                  (result, error) -> {
                    if (error == null) flushed.complete(null);
                    else flushed.completeExceptionally(error);
                  });
            });
      } catch (RejectedExecutionException busy) {
        flushed.completeExceptionally(busy);
      }
    }
    try {
      CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new)).get(10, TimeUnit.SECONDS);
    } catch (Exception incomplete) {
      org.slf4j.LoggerFactory.getLogger(RoomManager.class)
          .warn("Room shutdown flush did not complete within the deadline");
    }
  }
}
