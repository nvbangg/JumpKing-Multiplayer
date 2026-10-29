package jumpking.service;

import java.time.Clock;
import java.util.function.Consumer;
import jumpking.dto.AccountCredentials;
import jumpking.dto.AccountDto;
import jumpking.entity.User;
import jumpking.exception.ApiException;
import jumpking.repository.UserRepository;
import jumpking.room.Memberships;
import jumpking.security.AuthRateLimiter;
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
  private final AuthRateLimiter limits;

  public AccountService(
      UserRepository users,
      PasswordEncoder passwords,
      AuthenticationManager authentication,
      TransactionTemplate transactions,
      Memberships memberships,
      Clock clock,
      GoogleTokenVerifier googleVerifier,
      AuthRateLimiter limits) {
    this.users = users;
    this.passwords = passwords;
    this.authentication = authentication;
    this.transactions = transactions;
    this.memberships = memberships;
    this.clock = clock;
    this.googleVerifier = googleVerifier;
    this.limits = limits;
  }

  private AccountDto.Account register(
      AccountCredentials.Registration form, Consumer<AccountDto.Account> authenticated) {
    form.validate();
    var hash = passwords.encode(form.password());
    try {
      var account =
          transactions.execute(
              status ->
                  IdentityContext.accountView(
                      users.saveAndFlush(User.account(form.username(), hash, clock.instant()))));
      return completeLogin(null, Long.parseLong(account.id()), hash, authenticated);
    } catch (DataIntegrityViolationException duplicate) {
      throw new ApiException(409, "CONFLICT", "Username is unavailable");
    }
  }

  public AccountDto.Account login(
      AccountCredentials.Login form, Long current, Consumer<AccountDto.Account> authenticated) {
    var existing = users.findByUsername(form.username());
    if (existing.isEmpty()) {
      if (current != null)
        throw new ApiException(409, "CONFLICT", "Sign out before creating another account");
      try {
        return register(
            new AccountCredentials.Registration(form.username(), form.password()), authenticated);
      } catch (ApiException conflict) {
        // Request khác có thể vừa tạo username; chỉ tiếp tục bằng xác thực mật khẩu hiện có.
        if (conflict.status() != 409 || !"CONFLICT".equals(conflict.code())) throw conflict;
        existing = users.findByUsername(form.username());
        if (existing.isEmpty()) throw conflict;
      }
    }
    var verified = existing.orElseThrow(AccountService::invalidCredentials);
    long owner = verified.getId();
    String verifiedHash = verified.getPasswordHash();
    limits.checkAccount(owner);
    if (verifiedHash == null || !AccountCredentials.passwordWithinBcrypt(form.password()))
      throw invalidCredentials();
    try {
      authentication.authenticate(
          UsernamePasswordAuthenticationToken.unauthenticated(form.username(), form.password()));
    } catch (AuthenticationException invalid) {
      throw invalidCredentials();
    }
    return completeLogin(current, owner, verifiedHash, authenticated);
  }

  private AccountDto.Account completeLogin(
      Long current, long owner, String verifiedHash, Consumer<AccountDto.Account> authenticated) {
    return memberships.changingIdentity(
        current,
        owner,
        () ->
            transactions.execute(
                status -> {
                  var user = users.lockById(owner).orElseThrow(AccountService::invalidCredentials);
                  // Dùng cùng khóa với đổi mật khẩu để không tạo phiên từ mật khẩu cũ.
                  if (!java.util.Objects.equals(user.getPasswordHash(), verifiedHash))
                    throw invalidCredentials();
                  var account = IdentityContext.accountView(user);
                  authenticated.accept(account);
                  return account;
                }));
  }

  public AccountDto.Account loginWithGoogle(
      String idToken, Long current, Consumer<AccountDto.Account> authenticated) {
    if (idToken == null || idToken.isBlank()) throw invalidCredentials();
    var profile = googleVerifier.verify(idToken);
    if (profile == null || profile.googleId() == null || profile.googleId().isBlank()) {
      throw invalidCredentials();
    }

    var existing = users.findByGoogleId(profile.googleId());
    existing.ifPresent(user -> limits.checkAccount(user.getId()));
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
    for (int attempt = 0; attempt < 8; attempt++) {
      String candidate =
          attempt == 0
              ? base
              : usernamePrefix(base, 25)
                  + "_"
                  + java.util.UUID.randomUUID().toString().substring(0, 6);
      try {
        return transactions.execute(
            status ->
                IdentityContext.accountView(
                    users.saveAndFlush(
                        User.googleAccount(candidate, profile.googleId(), clock.instant()))));
      } catch (DataIntegrityViolationException duplicate) {
        var existing = users.findByGoogleId(profile.googleId());
        if (existing.isPresent()) return IdentityContext.accountView(existing.get());
      }
    }
    throw new ApiException(409, "CONFLICT", "Unable to create Google account");
  }

  private static String usernamePrefix(String value, int maximum) {
    return value.substring(
        0, value.offsetByCodePoints(0, Math.min(maximum, value.codePointCount(0, value.length()))));
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
    return usernamePrefix(base, 28);
  }

  public void changePassword(long owner, AccountCredentials.PasswordChange form) {
    limits.checkAccount(owner);
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
