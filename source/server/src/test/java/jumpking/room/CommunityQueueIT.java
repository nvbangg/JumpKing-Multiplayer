package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import java.util.Map;
import java.util.concurrent.*;
import jumpking.JumpKingApplication;
import jumpking.network.SerialExecutor;
import jumpking.support.GameClient;
import jumpking.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

@SpringBootTest(
    classes = JumpKingApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "app.allowed-origins=http://allowed.test,http://queue.test",
      "app.network.command-queue=2"
    })
class CommunityQueueIT {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    var db = TestDatabase.get().dataSource;
    properties.add("spring.datasource.url", db::getUrl);
    properties.add("spring.datasource.username", db::getUsername);
    properties.add("spring.datasource.password", db::getPassword);
  }

  @Autowired CommunityTower server;
  @Autowired Memberships memberships;
  @LocalServerPort int port;

  @Test
  void rejectedJoinReleasesItsMembershipAndColorAndCanRetryAfterBackpressure() throws Exception {
    var release = new CountDownLatch(1);
    try (var a = new GameClient(port);
        var b = new GameClient(port)) {
      a.register();
      b.register();
      a.connect();
      b.connect();
      String roomId = a.ok("JOIN_COMMUNITY", a.communityRequest()).path("roomId").asText();
      a.await(message -> message.path("type").asText().equals("GAME_SNAPSHOT"));
      Object room = ((Map<?, ?>) ReflectionTestUtils.getField(server, "towers")).get(roomId);
      ((ScheduledFuture<?>) ReflectionTestUtils.getField(room, "timer")).cancel(false);
      var actor = (SerialExecutor) ReflectionTestUtils.getField(room, "actor");
      var entered = new CountDownLatch(1);
      actor.execute(
          () -> {
            entered.countDown();
            try {
              if (!release.await(8, TimeUnit.SECONDS))
                throw new IllegalStateException("Queue fixture timeout");
            } catch (InterruptedException stopped) {
              Thread.currentThread().interrupt();
            }
          });
      assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
      try {
        for (; ; ) actor.execute(() -> {});
      } catch (RejectedExecutionException full) {
        /* Đã lấp đúng hạn queue của cấu hình test. */
      }
      var rejected = b.command("JOIN_COMMUNITY", b.communityRequest());
      assertThat(rejected.path("payload").path("code").asText()).isEqualTo("RATE_LIMITED");
      assertThat(memberships.find(b.owner)).isNull();
      release.countDown();
      var drained = new CompletableFuture<Void>();
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
      for (; ; ) {
        try {
          actor.execute(() -> drained.complete(null));
          break;
        } catch (RejectedExecutionException full) {
          assertThat(System.nanoTime()).isLessThan(deadline);
          Thread.sleep(10);
        }
      }
      drained.get(3, TimeUnit.SECONDS);
      b.ok("JOIN_COMMUNITY", b.communityRequest());
      var joined =
          b.await(message -> message.path("type").asText().equals("ROOM_JOINED")).path("payload");
      assertThat(b.ok("GET_ROOM_STATE", Map.of()).path("members").size()).isEqualTo(2);
      var member = b.ok("GET_ROOM_STATE", Map.of()).path("members").get(1);
      assertThat(member.path("colorSlot").asInt()).isEqualTo(1);
      assertThat(joined.path("roomId").asText()).isEqualTo(roomId);
      a.ok("LEAVE_ROOM", Map.of());
      b.ok("LEAVE_ROOM", Map.of());
    } finally {
      release.countDown();
    }
  }
}
