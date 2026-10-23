package jumpking.controller;

import static jumpking.dto.AccountDto.*;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import jumpking.dto.AccountCredentials;
import jumpking.dto.AccountDto;
import jumpking.exception.ApiException;
import jumpking.security.IdentityContext;
import jumpking.service.AccountService;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AccountController {
  private final AccountService accounts;
  private final IdentityContext identity;
  private final HttpSessionSecurityContextRepository contexts;
  private final HttpSessionCsrfTokenRepository csrf;
  private final ServerProperties server;
  private final jumpking.security.SessionAuthority authority;

  public AccountController(
      AccountService accounts,
      IdentityContext identity,
      HttpSessionSecurityContextRepository contexts,
      HttpSessionCsrfTokenRepository csrf,
      ServerProperties server,
      jumpking.security.SessionAuthority authority) {
    this.accounts = accounts;
    this.identity = identity;
    this.contexts = contexts;
    this.csrf = csrf;
    this.server = server;
    this.authority = authority;
  }

  @PostMapping("/register")
  public AccountDto.Me register(
      @Valid @RequestBody AccountCredentials.Registration form,
      HttpServletRequest request,
      HttpServletResponse response) {
    if (identity.account() != null)
      throw new ApiException(409, "CONFLICT", "Sign out before creating another account");
    var account = accounts.register(form, value -> signIn(value, request, response));
    return new AccountDto.Me(true, account);
  }

  @PostMapping("/login")
  public AccountDto.Me login(
      @Valid @RequestBody AccountCredentials.Login form,
      HttpServletRequest request,
      HttpServletResponse response) {
    var account = accounts.login(form, identity.owner(), value -> signIn(value, request, response));
    return new AccountDto.Me(true, account);
  }
  @PostMapping("/google")
  public AccountDto.Me google(
      @Valid @RequestBody AccountCredentials.GoogleLogin form,
      HttpServletRequest request,
      HttpServletResponse response) {
    var account =
        accounts.loginWithGoogle(
            form.idToken(), identity.owner(), value -> signIn(value, request, response));
    return new AccountDto.Me(true, account);
  }


  @PostMapping("/password")
  public Map<String, Boolean> password(@Valid @RequestBody AccountCredentials.PasswordChange form) {
    var account = identity.requireAccount();
    accounts.changePassword(Long.parseLong(account.id()), form);
    authority.revokeAccount(account.username());
    SecurityContextHolder.clearContext();
    return Map.of("ok", true);
  }

  @PostMapping("/logout")
  public Map<String, Boolean> logout(HttpServletRequest request, HttpServletResponse response) {
    var session = request.getSession(false);
    if (session != null) session.invalidate();
    SecurityContextHolder.clearContext();
    var cookie = server.getServlet().getSession().getCookie();
    String name = cookie.getName() == null ? "JSESSIONID" : cookie.getName();
    response.addHeader(
        HttpHeaders.SET_COOKIE,
        ResponseCookie.from(name, "")
            .path("/")
            .httpOnly(true)
            .sameSite("Lax")
            .secure(Boolean.TRUE.equals(cookie.getSecure()))
            .maxAge(0)
            .build()
            .toString());
    return Map.of("ok", true);
  }

  private void signIn(
      AccountDto.Account account, HttpServletRequest request, HttpServletResponse response) {
    request.getSession(true);
    request.changeSessionId();
    var context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(
        UsernamePasswordAuthenticationToken.authenticated(
            account.username(), null, List.of(new SimpleGrantedAuthority("ROLE_ACCOUNT"))));
    SecurityContextHolder.setContext(context);
    contexts.saveContext(context, request, response);
    csrf.saveToken(null, request, response);
  }
}
