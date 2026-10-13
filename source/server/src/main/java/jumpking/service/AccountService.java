package jumpking.service;

import java.time.Clock;
import java.util.function.Consumer;
import jumpking.dto.AccountCredentials;
import jumpking.dto.AccountDto;
import jumpking.entity.User;
import jumpking.exception.ApiException;
import jumpking.repository.UserRepository;
import jumpking.room.Memberships;
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

  public AccountService(
      UserRepository users,
      PasswordEncoder passwords,
      AuthenticationManager authentication,
      TransactionTemplate transactions,
      Memberships memberships,
      Clock clock) {
    this.users = users;
    this.passwords = passwords;
    this.authentication = authentication;
    this.transactions = transactions;
    this.memberships = memberships;
    this.clock = clock;
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
    if (!AccountCredentials.passwordWithinBcrypt(form.password())) throw invalidCredentials();
    try {
      authentication.authenticate(
          UsernamePasswordAuthenticationToken.unauthenticated(form.username(), form.password()));
    } catch (AuthenticationException invalid) {
      throw invalidCredentials();
    }
    var account =
        users
            .findByTypeAndUsername("ACCOUNT", form.username())
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
          if (!"ACCOUNT".equals(user.getType())
              || !passwords.matches(form.currentPassword(), user.getPasswordHash()))
            throw invalidCredentials();
          user.setPasswordHash(hash);
        });
  }

  private static ApiException invalidCredentials() {
    return new ApiException(401, "INVALID_CREDENTIALS", "Username or password is incorrect");
  }
}
