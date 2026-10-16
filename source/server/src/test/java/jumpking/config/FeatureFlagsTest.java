package jumpking.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class FeatureFlagsTest {
  @Test
  void oneServerFlagControlsFlyInEveryProfile() {
    var env = new MockEnvironment().withProperty("app.fly-enabled", "true");
    assertThat(new FeatureFlags(env).flyEnabled()).isTrue();
    for (String profile : new String[] {"local", "prod"}) {
      env.setActiveProfiles(profile);
      env.setProperty("app.fly-enabled", "true");
      assertThat(new FeatureFlags(env).flyEnabled()).isTrue();
      env.setProperty("app.fly-enabled", "false");
      assertThat(new FeatureFlags(env).flyEnabled()).isFalse();
    }
  }

  @Test
  void defaultIsOff() {
    var env = new MockEnvironment();
    assertThat(new FeatureFlags(env).flyEnabled()).isFalse();
  }
}
