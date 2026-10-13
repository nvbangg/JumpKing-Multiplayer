package jumpking.controller;

import java.util.Map;
import jumpking.dto.AccountDto;
import jumpking.security.IdentityContext;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class IdentityController {
  private final IdentityContext identity;

  public IdentityController(IdentityContext identity) {
    this.identity = identity;
  }

  @GetMapping("/csrf")
  public Map<String, String> csrf(CsrfToken token) {
    return Map.of("token", token.getToken(), "headerName", token.getHeaderName());
  }

  @GetMapping("/me")
  public AccountDto.Me me() {
    return identity.me();
  }
}
