package jumpking.network;

import java.util.ArrayDeque;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;

/** Hàng đợi tuần tự có giới hạn; không giữ lock trong khi chạy task. */
public final class SerialExecutor implements Executor {
  private final Executor workers;
  private final int capacity, completionCapacity;
  private final Consumer<Throwable> failure;
  private final ArrayDeque<Runnable> queue = new ArrayDeque<>();
  private final ArrayDeque<Runnable> completions = new ArrayDeque<>();
  private boolean running;

  public SerialExecutor(Executor workers, int capacity, Consumer<Throwable> failure) {
    this(workers, capacity, capacity, failure);
  }

  public SerialExecutor(
      Executor workers, int capacity, int completionCapacity, Consumer<Throwable> failure) {
    if (capacity < 1 || completionCapacity < 1)
      throw new IllegalArgumentException("Actor queues must be positive");
    this.workers = workers;
    this.capacity = capacity;
    this.completionCapacity = completionCapacity;
    this.failure = failure;
  }

  @Override
  public synchronized void execute(Runnable task) {
    enqueue(queue, capacity, task);
  }

  /** Callback đã nhận việc và disconnect không tranh chỗ với lệnh mới từ client. */
  public synchronized void complete(Runnable task) {
    enqueue(completions, completionCapacity, task);
  }

  private void enqueue(ArrayDeque<Runnable> tasks, int limit, Runnable task) {
    if (tasks.size() >= limit) throw new RejectedExecutionException("Game actor queue is full");
    tasks.add(task);
    if (!running) {
      running = true;
      try {
        workers.execute(this::drain);
      } catch (RejectedExecutionException error) {
        running = false;
        tasks.removeLast();
        throw error;
      }
    }
  }

  private void drain() {
    for (; ; ) {
      Runnable next;
      synchronized (this) {
        next = completions.poll();
        if (next == null) next = queue.poll();
        if (next == null) {
          running = false;
          return;
        }
      }
      try {
        next.run();
      } catch (Throwable error) {
        try {
          failure.accept(error);
        } catch (Throwable handlerFailure) {
          org.slf4j.LoggerFactory.getLogger(SerialExecutor.class)
              .error("Game actor failure handler failed", handlerFailure);
        }
      }
    }
  }
}
