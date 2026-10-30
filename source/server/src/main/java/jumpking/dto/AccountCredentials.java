package jumpking.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.nio.charset.StandardCharsets;
import jumpking.exception.ApiException;
import org.hibernate.validator.constraints.CodePointLength;

public final class AccountCredentials {
  private AccountCredentials() {}

  public record Registration(@NotNull String username, @NotNull String password) {
    public Registration {
      username = username == null ? null : username.strip();
    }

    public void validate() {
      validateUsername(username);
      validatePassword(password);
    }
  }

  public record Login(
      @NotBlank @CodePointLength(max = 32) String username, @NotNull String password) {
    public Login {
      username = username == null ? null : username.strip();
    }
  }

  public record UsernameChange(@NotNull String username) {
    public UsernameChange {
      username = username == null ? null : username.strip();
    }
  }

  public record PasswordChange(@NotNull String currentPassword, @NotNull String newPassword) {}

  public record GoogleLogin(@NotBlank String idToken) {}

  public static void validateUsername(String username) {
    if (username == null
        || username.codePointCount(0, username.length()) < 3
        || username.codePointCount(0, username.length()) > 32
        || !username.matches("[\\p{L}\\p{N}_-]+"))
      throw new ApiException(
          400, "VALIDATION", "Username must contain 3–32 letters, numbers, underscores or hyphens");
  }

  public static void validatePassword(String password) {
    if (password == null
        || password.codePointCount(0, password.length()) < 6
        || !passwordWithinBcrypt(password))
      throw new ApiException(
          400,
          "VALIDATION",
          "Password must have at least 6 characters and no more than 72 UTF-8 bytes");
  }

  public static boolean passwordWithinBcrypt(String password) {
    return password != null
        && password.getBytes(StandardCharsets.UTF_8).length <= 72
        && password.codePoints().noneMatch(p -> p >= 0xD800 && p <= 0xDFFF);
  }
}
