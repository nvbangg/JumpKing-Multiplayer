package jumpking.network;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import jumpking.config.NetworkSettings;
import jumpking.exception.ApiException;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

public final class GameConnection {
  public record Identity(long owner, String username, String sessionId, String ip) {
    public boolean account() {
      return username != null;
    }
  }

  private record Cached(String type, JsonNode payload, ObjectNode reply) {}

  private final WebSocketSession socket;
  private final Identity identity;
  private final ObjectMapper json;
  private final NetworkSettings limits;
  private final Executor sends, closes;
  private final Runnable onClosed;
  private final ArrayDeque<String> controls = new ArrayDeque<>();
  private final LinkedHashMap<String, Cached> replies = new LinkedHashMap<>();
  private final Map<String, GameEnvelope> inFlight = new LinkedHashMap<>();
  private final AtomicBoolean closed = new AtomicBoolean();
  private String latestSnapshot;
  private boolean sending;
  private long oldestPendingNs, sendingSinceNs;
  private volatile long lastReceivedNs = System.nanoTime();
  private long rateWindow = System.nanoTime();
  private int messages;
  public final SerialExecutor commands;

  public GameConnection(
      WebSocketSession socket,
      Identity identity,
      ObjectMapper json,
      NetworkSettings limits,
      Executor workers,
      Executor sends,
      Executor closes,
      Runnable onClosed) {
    this.socket = socket;
    this.identity = identity;
    this.json = json;
    this.limits = limits;
    this.sends = sends;
    this.closes = closes;
    this.onClosed = onClosed;
    commands =
        new SerialExecutor(
            workers, limits.commandQueue(), error -> close(CloseStatus.SERVER_ERROR));
  }

  public String id() {
    return socket.getId();
  }

  public Identity identity() {
    return identity;
  }

  public boolean open() {
    return !closed.get() && socket.isOpen();
  }

  public synchronized boolean receive(long now) {
    if (now - rateWindow >= 1_000_000_000L) {
      rateWindow = now;
      messages = 0;
    }
    if (++messages > limits.messagesPerSecond()) return false;
    lastReceivedNs = now;
    return true;
  }

  public synchronized boolean begin(GameEnvelope command) {
    if (command.requestId() == null) return true;
    Cached previous = replies.get(command.requestId());
    if (previous != null) {
      if (!previous.type.equals(command.type()) || !previous.payload.equals(command.payload()))
        throw new ApiException(409, "CONFLICT", "Request ID was already used");
      enqueue(previous.reply, false);
      return false;
    }
    var pending = inFlight.get(command.requestId());
    if (pending != null) {
      if (!pending.type().equals(command.type()) || !pending.payload().equals(command.payload()))
        throw new ApiException(409, "CONFLICT", "Request ID is still in use");
      return false;
    }
    if (inFlight.size() >= limits.controlMessages())
      throw new ApiException(429, "RATE_LIMITED", "Too many pending commands");
    inFlight.put(command.requestId(), command);
    return true;
  }

  public synchronized void reply(GameEnvelope command, String type, Object payload) {
    ObjectNode envelope = envelope(type, payload);
    if (command.requestId() != null) {
      envelope.put("requestId", command.requestId());
      inFlight.remove(command.requestId());
      replies.put(
          command.requestId(),
          new Cached(command.type(), command.payload().deepCopy(), envelope.deepCopy()));
      while (replies.size() > limits.controlMessages())
        replies.remove(replies.keySet().iterator().next());
    }
    enqueue(envelope, false);
  }

  public void error(GameEnvelope command, ApiException error) {
    var payload = Map.of("code", error.code(), "message", error.getMessage());
    if (command == null) send("ERROR", payload);
    else reply(command, "ERROR", payload);
  }

  public synchronized void reject(GameEnvelope command, ApiException error) {
    var envelope = envelope("ERROR", Map.of("code", error.code(), "message", error.getMessage()));
    if (command.requestId() != null) envelope.put("requestId", command.requestId());
    enqueue(envelope, false);
  }

  public synchronized void send(String type, Object payload) {
    enqueue(envelope(type, payload), false);
  }

  public synchronized void snapshot(Object payload) {
    enqueue(envelope("GAME_SNAPSHOT", payload), true);
  }

  private ObjectNode envelope(String type, Object payload) {
    var result = json.createObjectNode().put("v", 1).put("type", type);
    result.set("payload", payload instanceof JsonNode node ? node : json.valueToTree(payload));
    return result;
  }

  private void enqueue(ObjectNode envelope, boolean snapshot) {
    if (!open()) return;
    String text = envelope.toString();
    if (text.getBytes(StandardCharsets.UTF_8).length > limits.messageBytes()) {
      close(CloseStatus.TOO_BIG_TO_PROCESS);
      return;
    }
    if (snapshot) latestSnapshot = text;
    else {
      if (controls.size() >= limits.controlMessages()) {
        close(CloseStatus.POLICY_VIOLATION);
        return;
      }
      controls.add(text);
    }
    if (oldestPendingNs == 0) oldestPendingNs = System.nanoTime();
    if (!sending) {
      sending = true;
      try {
        sends.execute(this::drain);
      } catch (RejectedExecutionException error) {
        close(CloseStatus.SERVICE_OVERLOAD);
      }
    }
  }

  private void drain() {
    while (open()) {
      String next;
      synchronized (this) {
        next = controls.poll();
        if (next == null) {
          next = latestSnapshot;
          latestSnapshot = null;
        }
        if (next == null) {
          sending = false;
          oldestPendingNs = sendingSinceNs = 0;
          return;
        }
        sendingSinceNs = System.nanoTime();
      }
      try {
        socket.sendMessage(new TextMessage(next));
      } catch (Exception error) {
        close(CloseStatus.SERVER_ERROR);
        return;
      }
      synchronized (this) {
        oldestPendingNs = controls.isEmpty() && latestSnapshot == null ? 0 : System.nanoTime();
        sendingSinceNs = 0;
      }
    }
  }

  public synchronized void checkDeadline(long now) {
    if (now - lastReceivedNs >= limits.heartbeatExpiryMs() * 1_000_000L)
      close(CloseStatus.SESSION_NOT_RELIABLE);
    else if ((sendingSinceNs != 0 && now - sendingSinceNs >= limits.sendTimeoutMs() * 1_000_000L)
        || (oldestPendingNs != 0 && now - oldestPendingNs >= limits.sendTimeoutMs() * 1_000_000L))
      close(CloseStatus.SESSION_NOT_RELIABLE);
  }

  public void close(CloseStatus status) {
    if (!closed.compareAndSet(false, true)) return;
    synchronized (this) {
      controls.clear();
      latestSnapshot = null;
      inFlight.clear();
      replies.clear();
    }
    onClosed.run();
    try {
      closes.execute(
          () -> {
            try {
              socket.close(status);
            } catch (Exception ignored) {
            }
          });
    } catch (RejectedExecutionException ignored) {
      /* Container sẽ đóng socket khi hết idle timeout. */
    }
  }
}
