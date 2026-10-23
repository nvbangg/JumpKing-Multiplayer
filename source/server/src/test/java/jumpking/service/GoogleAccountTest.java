package jumpking.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class GoogleAccountTest {
  @Test
  void sanitizesSimpleName() {
    assertThat(AccountService.sanitizeGoogleUsername("Nguyen Van A", "a@gmail.com"))
        .isEqualTo("Nguyen_Van_A");
  }

  @Test
  void handlesSpecialCharactersAndSpaces() {
    assertThat(AccountService.sanitizeGoogleUsername("John Doe #123!", "john@test.com"))
        .isEqualTo("John_Doe_123");
  }

  @Test
  void handlesEmptyNameFallingBackToEmail() {
    assertThat(AccountService.sanitizeGoogleUsername("", "gamer99@gmail.com")).isEqualTo("gamer99");
  }

  @Test
  void prefixesShortNames() {
    assertThat(AccountService.sanitizeGoogleUsername("AB", "ab@gmail.com")).isEqualTo("Player_AB");
  }

  @Test
  void truncatesLongNames() {
    String longName = "A".repeat(50);
    assertThat(AccountService.sanitizeGoogleUsername(longName, "long@gmail.com").length())
        .isLessThanOrEqualTo(28);
  }
}
