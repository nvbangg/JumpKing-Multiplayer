package jumpking.config;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class FeatureFlags {
  private final boolean flyEnabled;

  public FeatureFlags(Environment environment) {
    flyEnabled = environment.getProperty("app.fly-enabled", Boolean.class, false);
  }

  public boolean flyEnabled() {
    return flyEnabled;
  }
}
