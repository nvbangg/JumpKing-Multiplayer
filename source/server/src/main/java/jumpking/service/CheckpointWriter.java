package jumpking.service;

import java.util.ArrayDeque;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;

/** Một writer/lượt; gộp autosave chưa ghi, giữ barrier và retry đúng payload/revision. */
public final class CheckpointWriter<T> {
  public enum Outcome {
    SAVED,
    SUPERSEDED,
    RETRYING,
    FAILED
  }

  private record Job<T>(T value, boolean barrier, BiConsumer<Outcome, Throwable> completion) {}

  private final ArrayDeque<Job<T>> queue = new ArrayDeque<>();
  private final Executor workers;
  private final ScheduledExecutorService retries;
  private final Consumer<T> write;
  private final int capacity, retryCount;
  private final long retryDelayMs;
  private boolean running;

  public CheckpointWriter(
      Executor workers,
      ScheduledExecutorService retries,
      Consumer<T> write,
      int capacity,
      int retryCount,
      long retryDelayMs) {
    this.workers = workers;
    this.retries = retries;
    this.write = write;
    this.capacity = capacity;
    this.retryCount = retryCount;
    this.retryDelayMs = retryDelayMs;
  }

  public void submit(T value, boolean barrier, BiConsumer<Outcome, Throwable> completion) {
    Job<T> replaced = null;
    synchronized (this) {
      if (!barrier && !queue.isEmpty() && !queue.getLast().barrier) replaced = queue.removeLast();
      if (queue.size() >= capacity)
        throw new RejectedExecutionException("Checkpoint queue is full");
      var job = new Job<>(value, barrier, completion);
      queue.add(job);
      if (!running) {
        running = true;
        try {
          workers.execute(this::next);
        } catch (RejectedExecutionException error) {
          running = false;
          queue.remove(job);
          throw error;
        }
      }
    }
    if (replaced != null) replaced.completion.accept(Outcome.SUPERSEDED, null);
  }

  private void next() {
    for (; ; ) {
      Job<T> job;
      synchronized (this) {
        job = queue.poll();
        if (job == null) {
          running = false;
          return;
        }
      }
      if (!attempt(job, 0)) return;
    }
  }

  private boolean attempt(Job<T> job, int failures) {
    try {
      write.accept(job.value);
    } catch (Throwable error) {
      if (error instanceof DataAccessException
          && !(error instanceof DataIntegrityViolationException)
          && failures < retryCount) {
        finish(job, Outcome.RETRYING, error);
        try {
          retries.schedule(
              () -> {
                try {
                  workers.execute(
                      () -> {
                        if (attempt(job, failures + 1)) next();
                      });
                } catch (RejectedExecutionException stopped) {
                  finish(job, Outcome.FAILED, stopped);
                  rejectPending(stopped);
                }
              },
              retryDelayMs,
              TimeUnit.MILLISECONDS);
          return false;
        } catch (RejectedExecutionException stopped) {
          finish(job, Outcome.FAILED, stopped);
          return true;
        }
      }
      finish(job, Outcome.FAILED, error);
      return true;
    }
    finish(job, Outcome.SAVED, null);
    return true;
  }

  private void rejectPending(Throwable error) {
    for (; ; ) {
      Job<T> job;
      synchronized (this) {
        job = queue.poll();
        if (job == null) {
          running = false;
          return;
        }
      }
      finish(job, Outcome.FAILED, error);
    }
  }

  private void finish(Job<T> job, Outcome outcome, Throwable error) {
    try {
      job.completion.accept(outcome, error);
    } catch (RuntimeException callbackFailure) {
      org.slf4j.LoggerFactory.getLogger(CheckpointWriter.class)
          .error("Checkpoint completion callback failed", callbackFailure);
    }
  }
}
