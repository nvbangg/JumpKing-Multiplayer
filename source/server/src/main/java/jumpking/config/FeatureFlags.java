package jumpking.config;

import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

@Component
public class FeatureFlags {
  private final boolean flyEnabled;

  public FeatureFlags(Environment environment) {
    flyEnabled =
        environment.acceptsProfiles(Profiles.of("local"))
            && !environment.acceptsProfiles(Profiles.of("prod"))
            && Boolean.parseBoolean(
                environment.getProperty(
                    "app.fly-enabled", environment.getProperty("FLY_ENABLED", "false")));
  }

  public boolean flyEnabled() {
    return flyEnabled;
  }
}
