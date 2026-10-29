package jumpking.network;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import jumpking.config.NetworkSettings;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.*;

class GameTransportTest {
  private final ObjectMapper json = new ObjectMapper();

  private NetworkSettings limits(int controls) {
    return new NetworkSettings(
        30, 2, 32, 256, 64, 20, 16384, 120, 120, controls, 240, 4, 8, 5000, 30000, 500, 60, 200, 50,
        1000);
  }

  @Test
  void handshakeAndPublicLookupQuotasRemainIndependentAndResetAtMinuteBoundary() {
    var now = new java.util.concurrent.atomic.AtomicLong(59_999);
    var clock = mock(java.time.Clock.class);
    when(clock.millis()).thenAnswer(call -> now.get());
    var workers = mock(GameWorkers.class);
    when(workers.executor()).thenReturn(Runnable::run);
    try (var transport =
        new GameTransport(
            limits(4),
            json,
            mock(jumpking.security.SessionAuthority.class),
            clock,
            List.of(),
            workers)) {
      for (int index = 0; index < 30; index++) transport.handshakeAttempt("one");
      for (int index = 0; index < 60; index++) transport.publicLookup("one");
      assertThatThrownBy(() -> transport.handshakeAttempt("one")).isInstanceOf(ApiException.class);
      assertThatThrownBy(() -> transport.publicLookup("one")).isInstanceOf(ApiException.class);
      now.set(60_000);
      transport.handshakeAttempt("one");
      transport.publicLookup("one");
    }
  }

  private GameEnvelope envelope(String type, String payload) {
    return GameEnvelope.parse(
        json,
        "{\"v\":1,\"type\":\"" + type + "\",\"requestId\":\"test\",\"payload\":" + payload + "}");
  }

  private GameEnvelope input(long sequence, String extras) {
    return GameEnvelope.parse(
        json,
        "{\"v\":1,\"type\":\"PLAYER_INPUT\",\"payload\":{\"playId\":\"run\",\"generation\":1,\"seq\":"
            + sequence
            + ",\"left\":false,\"right\":true,\"jump\":true"
            + extras
            + "}}");
  }

  @Test
  void strictEnvelopeRejectsUnknownFieldsTypesDuplicatesTrailingAndOversizedNumbers() {
    for (String text :
        List.of(
            "[]",
            "null",
            "{\"v\":1,\"v\":1}",
            "{\"v\":18446744073709551617,\"type\":\"HEARTBEAT\",\"requestId\":\"r\",\"payload\":{}}",
            "{\"v\":1,\"type\":\"HEARTBEAT\",\"requestId\":\"r\",\"payload\":{},\"position\":2}")) {
      assertThatThrownBy(() -> GameEnvelope.parse(json, text)).isInstanceOf(ApiException.class);
    }
    assertThatThrownBy(
            () ->
                GameEnvelope.parse(
                    json, "{\"v\":1,\"type\":\"HEARTBEAT\",\"requestId\":\"r\",\"payload\":{}} {}"))
        .isInstanceOf(ApiException.class);
    assertThat(envelope("HEARTBEAT", "{\"nonce\":\"n\"}").requestId()).isEqualTo("test");
  }

  @Test
  void inputAckOnlyMovesOnConsumptionAndTimeoutCancelsInsteadOfReleasingJump() {
    var frames = new InputFrames(2, 500);
    frames.reset("run", 1);
    long now = 1_000_000_000L;
    frames.offer(input(1, ""), now, false);
    frames.offer(input(2, ""), now, false);
    assertThat(frames.processed()).isZero();
    assertThat(frames.poll(now).seq()).isEqualTo(1);
    assertThat(frames.pending()).isEqualTo(1);
    assertThatThrownBy(() -> frames.offer(input(2, ""), now, false))
        .isInstanceOf(ApiException.class);
    var timeout = frames.poll(now + 500_000_000L);
    assertThat(timeout.cancel()).isTrue();
    assertThat(timeout.seq()).isEqualTo(1);
    assertThat(frames.pending()).isZero();
    frames.reset("run", 2);
    assertThatThrownBy(() -> frames.offer(input(3, ""), now, false))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void inputQueueAndFlightGateDoNotSilentlyDropEdges() {
    var frames = new InputFrames(1, 500);
    frames.reset("run", 1);
    long now = 1_000_000L;
    assertThatThrownBy(() -> frames.offer(input(1, ",\"freeFlight\":true"), now, false))
        .isInstanceOf(ApiException.class);
    frames.offer(input(1, ""), now, false);
    assertThatThrownBy(() -> frames.offer(input(2, ""), now, false))
        .isInstanceOf(ApiException.class);
    assertThat(frames.poll(now).seq()).isEqualTo(1);
    assertThatThrownBy(() -> frames.offer(input(2, ",\"up\":1"), now, false))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void backlogAgeIsBoundedEvenWhenFreshInputKeepsArriving() {
    var frames = new InputFrames(120, 500);
    frames.reset("run", 1);
    long now = 1_000_000_000L;
    frames.offer(input(1, ""), now, false);
    frames.offer(input(2, ""), now + 499_000_000L, false);
    assertThat(frames.requiresResync(now + 499_999_999L)).isFalse();
    assertThat(frames.requiresResync(now + 500_000_000L)).isTrue();
    assertThat(frames.processed()).isZero();
    frames.clear();
    assertThat(frames.requiresResync(now + 500_000_000L)).isFalse();
    frames.reset("run", 2);
    assertThat(frames.pending()).isZero();
    assertThat(frames.processed()).isZero();
  }

  @Test
  void fifoConsumptionMovesBacklogDeadlineWithoutDroppingAJumpEdge() {
    var frames = new InputFrames(120, 500);
    frames.reset("run", 1);
    long now = 1_000_000_000L;
    frames.offer(input(1, ""), now, false);
    frames.offer(input(2, ""), now + 100_000_000L, false);
    assertThat(frames.poll(now + 400_000_000L).seq()).isEqualTo(1);
    assertThat(frames.requiresResync(now + 500_000_000L)).isFalse();
    frames.offer(input(3, ""), now + 590_000_000L, false);
    assertThat(frames.requiresResync(now + 600_000_000L)).isTrue();
    assertThat(frames.requiresResync(now + 1_090_000_000L)).isFalse();
  }

  @Test
  void explicitCancelDiscardsQueuedMovementAndAckAdvancesOnlyWhenCancelIsConsumed() {
    var frames = new InputFrames(3, 500);
    frames.reset("run", 1);
    long now = 1_000_000L;
    frames.offer(input(1, ""), now, false);
    frames.offer(input(2, ""), now, false);
    var cancel =
        GameEnvelope.parse(
            json,
            "{\"v\":1,\"type\":\"CANCEL_INPUT\",\"payload\":{\"playId\":\"run\",\"generation\":1,\"seq\":3}}");
    frames.offer(cancel, now, false);
    assertThat(frames.pending()).isEqualTo(1);
    assertThat(frames.processed()).isZero();
    assertThat(frames.poll(now).cancel()).isTrue();
    assertThat(frames.processed()).isEqualTo(3);
  }

  @Test
  void serialExecutorIsBoundedOrderedAndSurvivesATaskFailure() {
    var scheduled = new ArrayDeque<Runnable>();
    var failures = new AtomicInteger();
    var order = new ArrayList<Integer>();
    var serial =
        new SerialExecutor(
            scheduled::add,
            3,
            error -> {
              failures.incrementAndGet();
              throw new IllegalStateException("Handler failed too");
            });
    serial.execute(() -> order.add(1));
    serial.execute(
        () -> {
          throw new IllegalStateException();
        });
    serial.execute(() -> order.add(2));
    assertThatThrownBy(() -> serial.execute(() -> {}))
        .isInstanceOf(java.util.concurrent.RejectedExecutionException.class);
    assertThat(scheduled).hasSize(1);
    scheduled.remove().run();
    assertThat(order).containsExactly(1, 2);
    assertThat(failures.get()).isEqualTo(1);
  }

  @Test
  void fullClientQueueCannotDropCommittedResultsAndBothQueuesRemainBounded() {
    var scheduled = new ArrayDeque<Runnable>();
    var order = new ArrayList<Integer>();
    var serial =
        new SerialExecutor(
            scheduled::add,
            2,
            2,
            error -> {
              throw new AssertionError(error);
            });
    serial.execute(() -> order.add(3));
    serial.execute(() -> order.add(4));
    assertThatThrownBy(() -> serial.execute(() -> {}))
        .isInstanceOf(java.util.concurrent.RejectedExecutionException.class);
    serial.complete(() -> order.add(1));
    serial.complete(() -> order.add(2));
    assertThatThrownBy(() -> serial.complete(() -> {}))
        .isInstanceOf(java.util.concurrent.RejectedExecutionException.class);
    assertThat(scheduled).hasSize(1);
    scheduled.remove().run();
    assertThat(order).containsExactly(1, 2, 3, 4);
  }

  @Test
  void snapshotsCoalesceAndRepliesRetainOnlyTheirOwnRequestId() throws Exception {
    var socket = mock(WebSocketSession.class);
    when(socket.isOpen()).thenReturn(true);
    var scheduled = new ArrayDeque<Runnable>();
    var texts = new ArrayList<String>();
    doAnswer(
            call -> {
              texts.add(((TextMessage) call.getArgument(0)).getPayload());
              return null;
            })
        .when(socket)
        .sendMessage(any());
    var connection =
        new GameConnection(
            socket,
            new GameConnection.Identity(1, null, null, "ip"),
            json,
            limits(64),
            Runnable::run,
            scheduled::add,
            Runnable::run,
            () -> {});
    connection.snapshot(java.util.Map.of("serverTick", 1));
    connection.snapshot(java.util.Map.of("serverTick", 2));
    var command = envelope("HEARTBEAT", "{\"nonce\":\"n\"}");
    assertThat(connection.begin(command)).isTrue();
    connection.reply(command, "PONG", command.payload());
    connection.send("ROOM_STATE", java.util.Map.of("members", List.of()));
    scheduled.remove().run();
    assertThat(texts).hasSize(3);
    assertThat(json.readTree(texts.get(0)).path("requestId").asText()).isEqualTo("test");
    assertThat(json.readTree(texts.get(1)).has("requestId")).isFalse();
    assertThat(json.readTree(texts.get(2)).path("payload").path("serverTick").asInt()).isEqualTo(2);
    assertThat(connection.begin(command)).isFalse();
    scheduled.remove().run();
    assertThat(texts.get(3)).isEqualTo(texts.get(0));
    assertThatThrownBy(() -> connection.begin(envelope("HEARTBEAT", "{\"nonce\":\"changed\"}")))
        .isInstanceOf(ApiException.class);
    assertThat(connection.begin(command)).isFalse();
  }

  @Test
  void snapshotsCoalesceBeforeEncodingAndDoNotHoldTheConnectionLockDuringIo() throws Exception {
    var socket = mock(WebSocketSession.class);
    when(socket.isOpen()).thenReturn(true);
    var scheduled = new ArrayDeque<Runnable>();
    var closed = new AtomicInteger();
    var connection =
        new GameConnection(
            socket,
            new GameConnection.Identity(1, "player", "session", "ip"),
            json,
            limits(64),
            Runnable::run,
            scheduled::add,
            Runnable::run,
            closed::incrementAndGet);
    var encodes = new AtomicInteger();
    var payload =
        new com.fasterxml.jackson.databind.JsonSerializable.Base() {
          @Override
          public void serialize(
              com.fasterxml.jackson.core.JsonGenerator generator,
              com.fasterxml.jackson.databind.SerializerProvider provider)
              throws java.io.IOException {
            assertThat(Thread.holdsLock(connection)).isFalse();
            generator.writeNumber(encodes.incrementAndGet());
          }

          @Override
          public void serializeWithType(
              com.fasterxml.jackson.core.JsonGenerator generator,
              com.fasterxml.jackson.databind.SerializerProvider provider,
              com.fasterxml.jackson.databind.jsontype.TypeSerializer type)
              throws java.io.IOException {
            serialize(generator, provider);
          }
        };
    connection.snapshot(payload);
    connection.snapshot(payload);
    assertThat(encodes.get()).isZero();
    doAnswer(
            call -> {
              assertThat(Thread.holdsLock(connection)).isFalse();
              return null;
            })
        .when(socket)
        .sendMessage(any());
    scheduled.remove().run();
    assertThat(encodes.get()).isEqualTo(1);
    verify(socket).sendMessage(any());
    connection.snapshot(java.util.Map.of("large", "😀".repeat(limits(64).messageBytes() / 4)));
    assertThat(connection.open()).isTrue();
    scheduled.remove().run();
    assertThat(connection.open()).isFalse();
    assertThat(closed.get()).isEqualTo(1);
    verify(socket, times(1)).sendMessage(any());
  }

  @Test
  void blockedSendAndOverflowCloseOnlyThatConnection() {
    var socket = mock(WebSocketSession.class);
    when(socket.isOpen()).thenReturn(true);
    var closed = new AtomicInteger();
    var neverRun = new ArrayDeque<Runnable>();
    var connection =
        new GameConnection(
            socket,
            new GameConnection.Identity(1, null, null, "ip"),
            json,
            limits(2),
            Runnable::run,
            neverRun::add,
            Runnable::run,
            closed::incrementAndGet);
    connection.send("PONG", java.util.Map.of("nonce", "n"));
    connection.checkDeadline(System.nanoTime() + 5_000_000_000L);
    assertThat(connection.open()).isFalse();
    assertThat(closed.get()).isEqualTo(1);
    connection.close(CloseStatus.NORMAL);
    assertThat(closed.get()).isEqualTo(1);
    var overflow =
        new GameConnection(
            socket,
            new GameConnection.Identity(2, null, null, "ip"),
            json,
            limits(2),
            Runnable::run,
            neverRun::add,
            Runnable::run,
            closed::incrementAndGet);
    overflow.send("PONG", java.util.Map.of());
    overflow.send("PONG", java.util.Map.of());
    overflow.send("PONG", java.util.Map.of());
    assertThat(overflow.open()).isFalse();
    assertThat(closed.get()).isEqualTo(2);
  }
}
