package jumpking.service;

import java.time.Clock;
import java.util.function.Consumer;
import jumpking.dto.AccountCredentials;
import jumpking.dto.AccountDto;
import jumpking.entity.User;
import jumpking.exception.ApiException;
import jumpking.repository.UserRepository;
import jumpking.room.Memberships;
import jumpking.security.GoogleTokenVerifier;
import jumpking.security.IdentityContext;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AccountService {
  private final UserRepository users;
  private final PasswordEncoder passwords;
  private final AuthenticationManager authentication;
  private final TransactionTemplate transactions;
  private final Memberships memberships;
  private final Clock clock;
  private final GoogleTokenVerifier googleVerifier;

  public AccountService(
      UserRepository users,
      PasswordEncoder passwords,
      AuthenticationManager authentication,
      TransactionTemplate transactions,
      Memberships memberships,
      Clock clock,
      GoogleTokenVerifier googleVerifier) {
    this.users = users;
    this.passwords = passwords;
    this.authentication = authentication;
    this.transactions = transactions;
    this.memberships = memberships;
    this.clock = clock;
    this.googleVerifier = googleVerifier;
  }

  public AccountDto.Account register(
      AccountCredentials.Registration form, Consumer<AccountDto.Account> authenticated) {
    form.validate();
    var hash = passwords.encode(form.password());
    try {
      var account =
          transactions.execute(
              status ->
                  IdentityContext.accountView(
                      users.saveAndFlush(User.account(form.username(), hash, clock.instant()))));
      authenticated.accept(account);
      return account;
    } catch (DataIntegrityViolationException duplicate) {
      throw new ApiException(409, "CONFLICT", "Username is unavailable");
    }
  }

  public AccountDto.Account login(
      AccountCredentials.Login form, Long current, Consumer<AccountDto.Account> authenticated) {
    if (users.findByUsername(form.username()).isEmpty()) {
      if (current != null)
        throw new ApiException(409, "CONFLICT", "Sign out before creating another account");
      try {
        return register(
            new AccountCredentials.Registration(form.username(), form.password()), authenticated);
      } catch (ApiException conflict) {
        // Request khác có thể vừa tạo username; chỉ tiếp tục bằng xác thực mật khẩu hiện có.
        if (conflict.status() != 409
            || !"CONFLICT".equals(conflict.code())
            || users.findByUsername(form.username()).isEmpty()) throw conflict;
      }
    }
    if (!AccountCredentials.passwordWithinBcrypt(form.password())) throw invalidCredentials();
    try {
      authentication.authenticate(
          UsernamePasswordAuthenticationToken.unauthenticated(form.username(), form.password()));
    } catch (AuthenticationException invalid) {
      throw invalidCredentials();
    }
    var account =
        users
            .findByUsername(form.username())
            .map(IdentityContext::accountView)
            .orElseThrow(AccountService::invalidCredentials);
    return memberships.changingIdentity(
        current,
        Long.valueOf(account.id()),
        () -> {
          authenticated.accept(account);
          return account;
        });
  }

  public AccountDto.Account loginWithGoogle(
      String idToken, Long current, Consumer<AccountDto.Account> authenticated) {
    if (idToken == null || idToken.isBlank()) throw invalidCredentials();
    var profile = googleVerifier.verify(idToken);
    if (profile == null || profile.googleId() == null || profile.googleId().isBlank()) {
      throw invalidCredentials();
    }

    var existing = users.findByGoogleId(profile.googleId());
    AccountDto.Account account;
    if (existing.isPresent()) {
      account = IdentityContext.accountView(existing.get());
    } else {
      if (current != null) {
        throw new ApiException(409, "CONFLICT", "Sign out before creating another account");
      }
      account = registerGoogleUser(profile);
    }

    return memberships.changingIdentity(
        current,
        Long.valueOf(account.id()),
        () -> {
          authenticated.accept(account);
          return account;
        });
  }

  private AccountDto.Account registerGoogleUser(GoogleTokenVerifier.Profile profile) {
    String base = sanitizeGoogleUsername(profile.name(), profile.email());
    String candidate = base;
    int suffix = 1;
    while (users.findByUsername(candidate).isPresent()) {
      candidate = base + "_" + suffix++;
      if (candidate.length() > 32) {
        base = base.substring(0, Math.min(base.length(), 26));
        candidate = base + "_" + suffix;
      }
    }

    final String finalUsername = candidate;
    try {
      return transactions.execute(
          status ->
              IdentityContext.accountView(
                  users.saveAndFlush(
                      User.googleAccount(finalUsername, profile.googleId(), clock.instant()))));
    } catch (DataIntegrityViolationException duplicate) {
      var existing = users.findByGoogleId(profile.googleId());
      if (existing.isPresent()) {
        return IdentityContext.accountView(existing.get());
      }
      throw new ApiException(409, "CONFLICT", "Unable to create Google account");
    }
  }

  public static String sanitizeGoogleUsername(String name, String email) {
    String base = name;
    if (base == null || base.isBlank()) {
      base =
          email != null && email.contains("@") ? email.substring(0, email.indexOf('@')) : "Player";
    }
    base = base.trim().replaceAll("\\s+", "_");
    base = base.replaceAll("[^\\p{L}\\p{N}_-]", "");
    if (base.length() < 3) {
      base = "Player_" + base;
    }
    if (base.length() > 28) {
      base = base.substring(0, 28);
    }
    return base;
  }

  public void changePassword(long owner, AccountCredentials.PasswordChange form) {
    AccountCredentials.validatePassword(form.newPassword());
    if (!AccountCredentials.passwordWithinBcrypt(form.currentPassword()))
      throw invalidCredentials();
    // Hash ngoài transaction; kiểm tra mật khẩu hiện tại dưới lock để hai yêu cầu không ghi đè
    // nhau.
    var hash = passwords.encode(form.newPassword());
    transactions.executeWithoutResult(
        status -> {
          var user = users.lockById(owner).orElseThrow(AccountService::invalidCredentials);
          if (user.getPasswordHash() == null) {
            throw new ApiException(409, "CONFLICT", "Google accounts do not have a password");
          }
          if (!passwords.matches(form.currentPassword(), user.getPasswordHash()))
            throw invalidCredentials();
          user.setPasswordHash(hash);
        });
  }

  private static ApiException invalidCredentials() {
    return new ApiException(401, "INVALID_CREDENTIALS", "Username or password is incorrect");
  }
}
