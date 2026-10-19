package jumpking.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

class AccountCredentialsTest {
  @Test
  void loginAndRegistrationAcceptThirtyTwoUnicodeCodePoints() {
    String username = "\uD840\uDC00".repeat(32);
    new AccountCredentials.Registration(username, "password123").validate();
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      assertThat(
              factory
                  .getValidator()
                  .validate(new AccountCredentials.Login(username, "password123")))
          .isEmpty();
    }
  }

  @Test
  void loginRejectsMoreThanThirtyTwoUnicodeCodePoints() {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      for (String username : new String[] {"a".repeat(33), "\uD840\uDC00".repeat(33)})
        assertThat(
                factory
                    .getValidator()
                    .validate(new AccountCredentials.Login(username, "password123")))
            .isNotEmpty();
    }
  }
}
