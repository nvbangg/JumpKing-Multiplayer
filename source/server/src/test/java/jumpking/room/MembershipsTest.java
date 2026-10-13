package jumpking.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;

class MembershipsTest {
  @Test
  void identityChangesDoNotBlockOtherMembershipsAndGateIsReleasedAfterFailure() throws Exception {
    var registry = new Memberships();
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var member = new Memberships.Membership("ABCDEF", "player");
    try (var threads = Executors.newSingleThreadExecutor()) {
      var change =
          threads.submit(
              () ->
                  registry.changingIdentity(
                      1L,
                      2L,
                      () -> {
                        entered.countDown();
                        try {
                          if (!release.await(5, TimeUnit.SECONDS))
                            throw new IllegalStateException("Coordination timeout");
                        } catch (InterruptedException error) {
                          Thread.currentThread().interrupt();
                          throw new IllegalStateException(error);
                        }
                        throw new IllegalStateException("Failed database operation");
                      }));
      assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
      assertThatThrownBy(() -> registry.claim(1, member)).isInstanceOf(ApiException.class);
      registry.claim(3, member);
      assertThat(registry.find(3)).isEqualTo(member);
      release.countDown();
      assertThatThrownBy(() -> change.get(5, TimeUnit.SECONDS))
          .hasCauseInstanceOf(IllegalStateException.class);
    } finally {
      release.countDown();
    }
    registry.claim(1, member);
    assertThat(registry.find(1)).isEqualTo(member);
  }

  @Test
  void reauthenticationKeepsMembershipWhileChangingOwnerIsRejected() {
    var registry = new Memberships();
    var member = new Memberships.Membership("ABCDEF", "player");
    registry.claim(1, member);
    assertThat(registry.changingIdentity(1L, 1L, () -> true)).isTrue();
    assertThatThrownBy(() -> registry.changingIdentity(1L, 2L, () -> true))
        .isInstanceOf(ApiException.class);
    assertThat(registry.find(1)).isEqualTo(member);
    registry.release(1, new Memberships.Membership("OTHER1", "player"));
    assertThat(registry.find(1)).isEqualTo(member);
  }
}
