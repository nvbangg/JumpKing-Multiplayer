package jumpking.service;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.TransientDataAccessResourceException;

class CheckpointWriterTest {
  @Test
  void coalescesOnlyUnwrittenAutosavesAndKeepsFlushOrderWithoutPrematureSaved() {
    var workers = new ArrayDeque<Runnable>();
    var saved = new ArrayList<Integer>();
    var superseded = new ArrayList<Integer>();
    try (var retries = Executors.newSingleThreadScheduledExecutor()) {
      var writer = new CheckpointWriter<Integer>(workers::add, retries, saved::add, 3, 3, 1);
      for (int id = 1; id <= 5; id++) {
        int value = id;
        writer.submit(
            value,
            id == 3,
            (outcome, error) -> {
              if (outcome == CheckpointWriter.Outcome.SUPERSEDED) superseded.add(value);
            });
      }
      assertThat(saved).isEmpty();
      assertThat(superseded).containsExactly(1, 4);
      assertThat(workers).hasSize(1);
      workers.remove().run();
      assertThat(saved).containsExactly(2, 3, 5);
    }
  }

  @Test
  void fullFlushQueueRejectsWithoutDroppingEarlierWork() {
    var workers = new ArrayDeque<Runnable>();
    var saved = new ArrayList<Integer>();
    try (var retries = Executors.newSingleThreadScheduledExecutor()) {
      var writer = new CheckpointWriter<Integer>(workers::add, retries, saved::add, 1, 3, 1);
      writer.submit(1, true, (outcome, error) -> {});
      assertThatThrownBy(() -> writer.submit(2, true, (outcome, error) -> {}))
          .isInstanceOf(RejectedExecutionException.class);
      workers.remove().run();
      assertThat(saved).containsExactly(1);
    }
  }

  @Test
  void retryKeepsSamePayloadAndNeverReportsSavedBeforeTheSuccessfulAttempt() throws Exception {
    var attempts = new AtomicInteger();
    var outcomes = new CopyOnWriteArrayList<CheckpointWriter.Outcome>();
    var saved = new CountDownLatch(1);
    var payload = new Object();
    try (var workers = Executors.newSingleThreadExecutor();
        var retries = Executors.newSingleThreadScheduledExecutor()) {
      var writer =
          new CheckpointWriter<Object>(
              workers,
              retries,
              value -> {
                assertThat(value).isSameAs(payload);
                if (attempts.incrementAndGet() < 3)
                  throw new TransientDataAccessResourceException("Unavailable");
              },
              4,
              3,
              1);
      writer.submit(
          payload,
          true,
          (outcome, error) -> {
            outcomes.add(outcome);
            if (outcome == CheckpointWriter.Outcome.SAVED) saved.countDown();
          });
      assertThat(saved.await(2, TimeUnit.SECONDS)).isTrue();
      assertThat(attempts.get()).isEqualTo(3);
      assertThat(outcomes)
          .containsExactly(
              CheckpointWriter.Outcome.RETRYING,
              CheckpointWriter.Outcome.RETRYING,
              CheckpointWriter.Outcome.SAVED);
    }
  }

  @Test
  void exhaustedRetryFailsOnceThenProcessesTheNextBarrierAndLogicalErrorsDoNotRetry()
      throws Exception {
    var attempts = new AtomicInteger();
    var outcomes = new ConcurrentHashMap<Integer, CheckpointWriter.Outcome>();
    var done = new CountDownLatch(3);
    try (var workers = Executors.newSingleThreadExecutor();
        var retries = Executors.newSingleThreadScheduledExecutor()) {
      var writer =
          new CheckpointWriter<Integer>(
              workers,
              retries,
              value -> {
                if (value == 1) {
                  attempts.incrementAndGet();
                  throw new TransientDataAccessResourceException("Unavailable");
                }
                if (value == 3) throw new ApiException(409, "CONFLICT", "Revision conflict");
              },
              4,
              3,
              1);
      for (int id = 1; id <= 3; id++) {
        int value = id;
        writer.submit(
            value,
            true,
            (outcome, error) -> {
              if (outcome != CheckpointWriter.Outcome.RETRYING) {
                outcomes.put(value, outcome);
                done.countDown();
              }
            });
      }
      assertThat(done.await(2, TimeUnit.SECONDS)).isTrue();
      assertThat(attempts.get()).isEqualTo(4);
      assertThat(outcomes)
          .containsEntry(1, CheckpointWriter.Outcome.FAILED)
          .containsEntry(2, CheckpointWriter.Outcome.SAVED)
          .containsEntry(3, CheckpointWriter.Outcome.FAILED);
    }
  }
}
