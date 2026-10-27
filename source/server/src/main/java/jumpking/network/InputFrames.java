package jumpking.network;

import java.util.ArrayDeque;
import jumpking.exception.ApiException;
import jumpking.game.PlayerInput;

/** Chỉ ACK frame đã xử lý; timeout hủy charge, không giả lập thả Jump. */
public final class InputFrames {
  public record Frame(long seq, PlayerInput input, boolean cancel) {}

  private record Queued(Frame frame, long receivedAt) {}

  private final int capacity;
  private final long timeoutNs;
  private final ArrayDeque<Queued> queue = new ArrayDeque<>();
  private String playId;
  private long generation, accepted, processed, lastReceived;
  private PlayerInput held = PlayerInput.NEUTRAL;

  public InputFrames(int capacity, long timeoutMs) {
    this.capacity = capacity;
    timeoutNs = timeoutMs * 1_000_000L;
  }

  public void reset(String id, long nextGeneration) {
    playId = id;
    generation = nextGeneration;
    accepted = processed = lastReceived = 0;
    clear();
  }

  public PlayerInput offer(GameEnvelope envelope, long now, boolean flyAllowed) {
    var p = envelope.payload();
    boolean cancel = envelope.type().equals("CANCEL_INPUT");
    GameEnvelope.fields(
        p,
        cancel
            ? java.util.Set.of("playId", "generation", "seq")
            : java.util.Set.of(
                "playId",
                "generation",
                "seq",
                "left",
                "right",
                "jump",
                "up",
                "down",
                "freeFlight"));
    String id = GameEnvelope.text(p, "playId");
    long gen = GameEnvelope.integer(p, "generation"), seq = GameEnvelope.integer(p, "seq");
    if (!id.equals(playId) || gen != generation)
      throw new ApiException(409, "STALE_PLAY", "Input belongs to an old play context");
    if (seq <= accepted) throw new ApiException(409, "STALE_INPUT", "Input sequence is stale");
    PlayerInput input =
        cancel
            ? PlayerInput.NEUTRAL
            : new PlayerInput(
                GameEnvelope.bool(p, "left", false),
                GameEnvelope.bool(p, "right", false),
                GameEnvelope.bool(p, "jump", false),
                GameEnvelope.bool(p, "up", true),
                GameEnvelope.bool(p, "down", true),
                GameEnvelope.bool(p, "freeFlight", true));
    if (Boolean.TRUE.equals(input.freeFlight()) && !flyAllowed)
      throw new ApiException(400, "INVALID_INPUT", "Flight is disabled");
    if (cancel) queue.clear();
    if (queue.size() >= capacity)
      throw new ApiException(429, "RATE_LIMITED", "Input queue is full; reconnect to resync");
    queue.add(new Queued(new Frame(seq, input, cancel), now));
    accepted = seq;
    lastReceived = now;
    return input;
  }

  public Frame poll(long now) {
    if (lastReceived == 0 || now - lastReceived >= timeoutNs) {
      clear();
      return new Frame(processed, held, true);
    }
    Queued queued = queue.poll();
    Frame next = queued == null ? null : queued.frame();
    if (next == null) return new Frame(processed, held, false);
    processed = next.seq();
    held = next.cancel() ? PlayerInput.NEUTRAL : next.input();
    return next;
  }

  public long processed() {
    return processed;
  }

  public int pending() {
    return queue.size();
  }

  public boolean requiresResync(long now) {
    return !queue.isEmpty()
        && now - lastReceived < timeoutNs
        && now - queue.peek().receivedAt() >= timeoutNs;
  }

  public void clear() {
    queue.clear();
    held = PlayerInput.NEUTRAL;
  }
}
