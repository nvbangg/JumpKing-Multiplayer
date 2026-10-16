package jumpking.security;

import jumpking.dto.AccountDto.*;
import jumpking.entity.User;
import jumpking.exception.ApiException;
import jumpking.repository.UserRepository;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class IdentityContext {
  private final UserRepository users;

  public IdentityContext(UserRepository users) {
    this.users = users;
  }

  public Account account() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken)
      return null;
    return users.findByUsername(auth.getName()).map(IdentityContext::accountView).orElse(null);
  }

  public static Account accountView(User user) {
    return new Account(user.getId().toString(), user.getUsername(), user.isCrownUnlocked());
  }

  public Account requireAccount() {
    var account = account();
    if (account == null) throw new ApiException(401, "UNAUTHENTICATED", "Sign in to continue");
    return account;
  }

  public Long owner() {
    var account = account();
    return account == null ? null : Long.valueOf(account.id());
  }

  public Me me() {
    var account = account();
    return new Me(account != null, account, account != null && account.crownUnlocked());
  }
}
