package jumpking.network;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
  private final ArrayDeque<ObjectNode> controls = new ArrayDeque<>();
  private final LinkedHashMap<String, Cached> replies = new LinkedHashMap<>();
  private final Map<String, GameEnvelope> inFlight = new LinkedHashMap<>();
  private final AtomicBoolean closed = new AtomicBoolean();
  private ObjectNode latestSnapshot;
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

  public boolean begin(GameEnvelope command) {
    if (command.requestId() == null) return true;
    ObjectNode replay;
    synchronized (this) {
      Cached previous = replies.get(command.requestId());
      if (previous != null) {
        if (!previous.type.equals(command.type()) || !previous.payload.equals(command.payload()))
          throw new ApiException(409, "CONFLICT", "Request ID was already used");
        replay = previous.reply;
      } else {
        var pending = inFlight.get(command.requestId());
        if (pending != null) {
          if (!pending.type().equals(command.type())
              || !pending.payload().equals(command.payload()))
            throw new ApiException(409, "CONFLICT", "Request ID is still in use");
          return false;
        }
        if (inFlight.size() >= limits.controlMessages())
          throw new ApiException(429, "RATE_LIMITED", "Too many pending commands");
        inFlight.put(command.requestId(), command);
        return true;
      }
    }
    enqueue(replay, false);
    return false;
  }

  public void reply(GameEnvelope command, String type, Object payload) {
    ObjectNode envelope = envelope(type, payload);
    if (command.requestId() != null) {
      envelope.put("requestId", command.requestId());
      synchronized (this) {
        inFlight.remove(command.requestId());
        replies.put(
            command.requestId(),
            new Cached(command.type(), command.payload().deepCopy(), envelope));
        while (replies.size() > limits.controlMessages())
          replies.remove(replies.keySet().iterator().next());
      }
    }
    enqueue(envelope, false);
  }

  public void error(GameEnvelope command, ApiException error) {
    var payload = Map.of("code", error.code(), "message", error.getMessage());
    if (command == null) send("ERROR", payload);
    else reply(command, "ERROR", payload);
  }

  public void reject(GameEnvelope command, ApiException error) {
    var envelope = envelope("ERROR", Map.of("code", error.code(), "message", error.getMessage()));
    if (command.requestId() != null) envelope.put("requestId", command.requestId());
    enqueue(envelope, false);
  }

  public void send(String type, Object payload) {
    enqueue(envelope(type, payload), false);
  }

  /** Payload đã được phòng chụp riêng; không sửa lại sau khi enqueue. */
  public void snapshot(Object payload) {
    var envelope = json.createObjectNode().put("v", 1).put("type", "GAME_SNAPSHOT");
    envelope.set("payload", json.getNodeFactory().pojoNode(payload));
    enqueue(envelope, true);
  }

  private ObjectNode envelope(String type, Object payload) {
    var result = json.createObjectNode().put("v", 1).put("type", type);
    result.set(
        "payload", payload instanceof JsonNode node ? node.deepCopy() : json.valueToTree(payload));
    return result;
  }

  private void enqueue(ObjectNode envelope, boolean snapshot) {
    boolean schedule = false;
    synchronized (this) {
      if (!open()) return;
      if (snapshot) latestSnapshot = envelope;
      else {
        if (controls.size() >= limits.controlMessages()) {
          close(CloseStatus.POLICY_VIOLATION);
          return;
        }
        controls.add(envelope);
      }
      if (oldestPendingNs == 0) oldestPendingNs = System.nanoTime();
      if (!sending) {
        sending = true;
        schedule = true;
      }
    }
    if (schedule) {
      try {
        sends.execute(this::drain);
      } catch (RejectedExecutionException error) {
        close(CloseStatus.SERVICE_OVERLOAD);
      }
    }
  }

  private void drain() {
    while (open()) {
      ObjectNode next;
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
        byte[] bytes = json.writeValueAsBytes(next);
        if (bytes.length > limits.messageBytes()) {
          close(CloseStatus.TOO_BIG_TO_PROCESS);
          return;
        }
        if (!open()) return;
        socket.sendMessage(new TextMessage(bytes));
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
