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
    for (String name : new String[] {"AB", "𠮷𠮷"}) {
      String username = AccountService.sanitizeGoogleUsername(name, "ab@gmail.com");
      assertThat(username).isEqualTo("Player_" + name);
      jumpking.dto.AccountCredentials.validateUsername(username);
    }
  }

  @Test
  void truncatesLongNames() {
    String longName = "𠮷".repeat(50);
    String username = AccountService.sanitizeGoogleUsername(longName, "long@gmail.com");
    assertThat(username.codePointCount(0, username.length())).isEqualTo(28);
    assertThat(username).endsWith("𠮷");
  }
}
