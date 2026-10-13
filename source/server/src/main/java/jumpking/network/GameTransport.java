package jumpking.network;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import jumpking.config.NetworkSettings;
import jumpking.exception.ApiException;
import jumpking.security.SessionAuthority;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class GameTransport extends TextWebSocketHandler implements AutoCloseable {
  public static final String IDENTITY = GameTransport.class.getName() + ".identity";

  private record Reservation(GameConnection.Identity identity, long created, boolean connected) {}

  private final NetworkSettings limits;
  private final ObjectMapper json;
  private final SessionAuthority sessions;
  private final Clock clock;
  private final List<GameCommandHandler> handlers;
  private final ConcurrentHashMap<String, GameConnection> connections = new ConcurrentHashMap<>();
  private final Map<String, Reservation> reservations = new HashMap<>();
  private final Map<String, Integer> buckets = new HashMap<>();
  private long bucketMinute = Long.MIN_VALUE;
  private final java.util.concurrent.Executor workers;
  private final ThreadPoolExecutor sends, closes;

  public GameTransport(
      NetworkSettings limits,
      ObjectMapper json,
      SessionAuthority sessions,
      Clock clock,
      List<GameCommandHandler> handlers,
      GameWorkers gameWorkers) {
    this.limits = limits;
    this.json = json;
    this.sessions = sessions;
    this.clock = clock;
    this.handlers = handlers;
    workers = gameWorkers.executor();
    sends = pool(limits.sendThreads(), limits.connections(), "game-send-");
    closes = pool(2, limits.connections(), "game-close-");
  }

  private static ThreadPoolExecutor pool(int threads, int queue, String name) {
    var sequence = new java.util.concurrent.atomic.AtomicInteger();
    return new ThreadPoolExecutor(
        threads,
        threads,
        0,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(queue),
        task -> {
          var thread = new Thread(task, name + sequence.incrementAndGet());
          thread.setDaemon(true);
          return thread;
        },
        new ThreadPoolExecutor.AbortPolicy());
  }

  public java.util.concurrent.Executor workers() {
    return workers;
  }

  private void quota(String key, int maximum) {
    long minute = Math.floorDiv(clock.millis(), 60_000L);
    if (minute != bucketMinute) {
      buckets.clear();
      bucketMinute = minute;
    }
    if (buckets.size() >= limits.connections() * 64 && !buckets.containsKey(key)) throw rate();
    var previous = buckets.get(key);
    if (previous != null && previous >= maximum) throw rate();
    buckets.put(key, previous == null ? 1 : previous + 1);
  }

  public synchronized void handshakeAttempt(String ip) {
    quota("handshake:" + ip, limits.handshakesPerMinute());
  }

  public synchronized void roomLookup(String ip) {
    quota("lookup:" + ip, limits.roomLookupsPerMinute());
  }

  public synchronized void joinAttempt(GameConnection connection) {
    quota("join-ip:" + connection.identity().ip(), limits.joinsPerMinute());
    quota("join-owner:" + connection.identity().owner(), limits.joinsPerMinute());
  }

  public synchronized String reserve(GameConnection.Identity identity) {
    int owned = 0, sameIp = 0;
    for (var value : reservations.values()) {
      if (value.identity.owner() == identity.owner()) owned++;
      if (value.identity.ip().equals(identity.ip())) sameIp++;
    }
    if (reservations.size() >= limits.connections()
        || owned >= limits.connectionsPerIdentity()
        || sameIp >= limits.connectionsPerIp()) throw rate();
    String key = java.util.UUID.randomUUID().toString();
    reservations.put(key, new Reservation(identity, System.nanoTime(), false));
    return key;
  }

  public synchronized void release(String key) {
    reservations.remove(key);
  }

  public int connectionCount() {
    return connections.size();
  }

  private static ApiException rate() {
    return new ApiException(429, "RATE_LIMITED", "Connection or command limit exceeded");
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession socket) {
    var identity = (GameConnection.Identity) socket.getAttributes().get(IDENTITY);
    String reservation = (String) socket.getAttributes().get("reservation");
    synchronized (this) {
      var reserved = reservations.get(reservation);
      if (reserved == null) {
        try {
          socket.close(CloseStatus.POLICY_VIOLATION);
        } catch (Exception ignored) {
        }
        return;
      }
      reservations.put(reservation, new Reservation(reserved.identity, reserved.created, true));
    }
    socket.setTextMessageSizeLimit(limits.messageBytes());
    socket.setBinaryMessageSizeLimit(limits.messageBytes());
    if (socket
        instanceof
        org.springframework.web.socket.adapter.standard.StandardWebSocketSession standard) {
      var nativeSession = standard.getNativeSession(jakarta.websocket.Session.class);
      nativeSession
          .getUserProperties()
          .put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT", limits.sendTimeoutMs());
      nativeSession
          .getUserProperties()
          .put("org.apache.tomcat.websocket.SESSION_CLOSE_TIMEOUT", limits.sendTimeoutMs());
    }
    var connection =
        new GameConnection(
            socket,
            identity,
            json,
            limits,
            workers,
            sends,
            closes,
            () -> {
              var removed = connections.remove(socket.getId());
              release(reservation);
              if (removed != null) handlers.forEach(handler -> handler.disconnected(removed));
            });
    connections.put(socket.getId(), connection);
    if (identity.sessionId() != null && sessions.find(identity.sessionId()) == null)
      connection.close(CloseStatus.POLICY_VIOLATION);
  }

  @Override
  protected void handleTextMessage(WebSocketSession socket, TextMessage text) {
    var connection = connections.get(socket.getId());
    if (connection == null || !connection.open()) return;
    if (text.getPayload().getBytes(java.nio.charset.StandardCharsets.UTF_8).length
        > limits.messageBytes()) {
      connection.close(CloseStatus.TOO_BIG_TO_PROCESS);
      return;
    }
    if (!connection.receive(System.nanoTime())) {
      connection.close(CloseStatus.POLICY_VIOLATION);
      return;
    }
    GameEnvelope command;
    try {
      command = GameEnvelope.parse(json, text.getPayload());
    } catch (ApiException error) {
      connection.error(null, error);
      return;
    }
    try {
      connection.commands.execute(() -> dispatch(connection, command));
    } catch (RejectedExecutionException error) {
      connection.close(CloseStatus.SERVICE_OVERLOAD);
    }
  }

  private void dispatch(GameConnection connection, GameEnvelope command) {
    if (!connection.open()) return;
    try {
      String sessionId = connection.identity().sessionId();
      if (sessionId != null && sessions.find(sessionId) == null) {
        connection.close(CloseStatus.POLICY_VIOLATION);
        return;
      }
      try {
        if (!connection.begin(command)) return;
      } catch (ApiException error) {
        connection.reject(command, error);
        return;
      }
      if (command.type().equals("HEARTBEAT")) {
        GameEnvelope.fields(command.payload(), Set.of("nonce"));
        connection.reply(
            command, "PONG", Map.of("nonce", GameEnvelope.text(command.payload(), "nonce")));
        return;
      }
      if (Set.of("CREATE_ROOM", "JOIN_ROOM", "JOIN_COMMUNITY").contains(command.type()))
        joinAttempt(connection);
      var handler =
          handlers.stream()
              .filter(candidate -> candidate.supports(connection, command))
              .findFirst()
              .orElse(null);
      if (handler != null) {
        handler.handle(connection, command);
        return;
      } else if (command.type().equals("GET_ROOM_STATE") || command.type().equals("LEAVE_ROOM")) {
        GameEnvelope.fields(command.payload(), Set.of());
        if (command.type().equals("LEAVE_ROOM"))
          connection.reply(
              command, "ROOM_LEFT", java.util.Collections.singletonMap("roomId", null));
        else {
          var empty = json.createObjectNode();
          for (String field :
              List.of(
                  "roomId", "kind", "state", "hostPlayerId", "settings", "currentPlay", "result"))
            empty.putNull(field);
          empty.putArray("members");
          connection.reply(command, "ROOM_STATE", empty);
        }
      } else if (command.type().equals("JOIN_ROOM"))
        throw new ApiException(404, "ROOM_NOT_FOUND", "Room not found");
      else if (command.type().equals("RECONNECT"))
        throw new ApiException(409, "RECONNECT_EXPIRED", "Reconnect is no longer available");
      else
        throw new ApiException(
            400, "INVALID_MESSAGE", "This command is not available in the current context");
      if (sessionId != null) sessions.valid(sessions.find(sessionId), true);
    } catch (ApiException error) {
      connection.error(command, error);
    } catch (RejectedExecutionException busy) {
      connection.error(command, rate());
    } catch (Exception error) {
      connection.error(
          command, new ApiException(500, "INTERNAL_ERROR", "Unable to process game command"));
    }
  }

  @Override
  protected void handleBinaryMessage(WebSocketSession socket, BinaryMessage message) {
    closeSocket(socket, CloseStatus.NOT_ACCEPTABLE);
  }

  @Override
  public void handleTransportError(WebSocketSession socket, Throwable exception) {
    closeSocket(socket, CloseStatus.SERVER_ERROR);
  }

  @Override
  public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
    closeSocket(socket, status);
  }

  private void closeSocket(WebSocketSession socket, CloseStatus status) {
    var connection = connections.get(socket.getId());
    if (connection != null) connection.close(status);
  }

  @EventListener
  public void revoked(SessionAuthority.Revoked event) {
    connections.values().stream()
        .filter(connection -> event.sessionId().equals(connection.identity().sessionId()))
        .forEach(connection -> connection.close(CloseStatus.POLICY_VIOLATION));
  }

  @Scheduled(fixedDelay = 1_000)
  public void deadlines() {
    long now = System.nanoTime();
    connections
        .values()
        .forEach(
            connection -> {
              if (connection.identity().sessionId() != null
                  && sessions.find(connection.identity().sessionId()) == null)
                connection.close(CloseStatus.POLICY_VIOLATION);
              else connection.checkDeadline(now);
            });
    synchronized (this) {
      // Reservation chưa thành socket chỉ được giữ trong thời gian handshake.
      reservations
          .entrySet()
          .removeIf(
              entry ->
                  now - entry.getValue().created >= limits.heartbeatExpiryMs() * 1_000_000L
                      && !entry.getValue().connected);
    }
  }

  @Override
  public void close() {
    connections.values().forEach(connection -> connection.close(CloseStatus.GOING_AWAY));
    sends.shutdownNow();
    closes.shutdown();
  }
}
