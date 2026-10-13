package jumpking.network;

import java.util.concurrent.*;
import jumpking.config.NetworkSettings;
import org.springframework.stereotype.Component;

@Component
public class GameWorkers implements AutoCloseable {
  private final ThreadPoolExecutor executor;

  public GameWorkers(NetworkSettings limits) {
    executor =
        new ThreadPoolExecutor(
            limits.workerThreads(),
            limits.workerThreads(),
            0,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(limits.connections() + limits.rooms()),
            Thread.ofPlatform().daemon().name("game-command-", 0).factory(),
            new ThreadPoolExecutor.AbortPolicy());
  }

  public Executor executor() {
    return executor;
  }

  @Override
  public void close() {
    executor.shutdown();
    try {
      if (!executor.awaitTermination(10, TimeUnit.SECONDS)) executor.shutdownNow();
    } catch (InterruptedException stopped) {
      Thread.currentThread().interrupt();
      executor.shutdownNow();
    }
  }
}
