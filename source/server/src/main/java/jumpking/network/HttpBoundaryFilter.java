package jumpking.network;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiErrors;
import jumpking.exception.ApiException;
import jumpking.security.AuthRateLimiter;
import jumpking.security.SessionAuthority;
import org.springframework.web.filter.OncePerRequestFilter;

public class HttpBoundaryFilter extends OncePerRequestFilter {
  private static final Set<String> AUTH_MUTATIONS =
      Set.of("/api/auth/register", "/api/auth/login", "/api/auth/password");
  private final SecuritySettings settings;
  private final SessionAuthority sessions;
  private final AuthRateLimiter limits;
  private final ObjectMapper json;

  public HttpBoundaryFilter(
      SecuritySettings settings,
      SessionAuthority sessions,
      AuthRateLimiter limits,
      ObjectMapper json) {
    this.settings = settings;
    this.sessions = sessions;
    this.limits = limits;
    this.json = json;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith("/api/")
        && !request.getRequestURI().startsWith("/ws/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    response.setHeader("Cache-Control", "no-store");
    try {
      String origin = request.getHeader("Origin");
      if ((origin != null && !settings.acceptsOrigin(origin))
          || (request.getRequestURI().startsWith("/ws/") && origin == null)) {
        throw new ApiException(403, "ORIGIN_DENIED", "Origin is not allowed");
      }
      var session = request.getSession(false);
      if (session != null && !sessions.valid(session, false))
        throw new ApiException(401, "SESSION_EXPIRED", "Your session has expired");
      String account = account(session);
      if (account != null
          && "PUT".equals(request.getMethod())
          && request.getRequestURI().startsWith("/api/solo/runs/")) limits.solo(account);
      if ("POST".equals(request.getMethod()) && AUTH_MUTATIONS.contains(request.getRequestURI())) {
        limits.check(request.getRemoteAddr(), account == null ? null : "account:" + account);
      }
      if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) {
        if (request.getContentLengthLong() > settings.httpBodyLimit())
          throw new ApiException(400, "VALIDATION", "Request body is too large");
        byte[] body = request.getInputStream().readNBytes(settings.httpBodyLimit() + 1);
        if (body.length > settings.httpBodyLimit())
          throw new ApiException(400, "VALIDATION", "Request body is too large");
        if (body.length > 0
            && (request.getContentType() == null
                || !request
                    .getContentType()
                    .split(";", 2)[0]
                    .trim()
                    .equalsIgnoreCase("application/json"))) {
          throw new ApiException(400, "VALIDATION", "A JSON request body is required");
        }
        request = buffered(request, body);
      }
      chain.doFilter(request, response);
      if (response.getStatus() < 400) sessions.valid(request.getSession(false), true);
    } catch (ApiException error) {
      if (error.status() == 429) response.setHeader("Retry-After", "60");
      ApiErrors.write(response, json, error.status(), error.code(), error.getMessage());
    }
  }

  private static String account(jakarta.servlet.http.HttpSession session) {
    Object security;
    try {
      security = session == null ? null : session.getAttribute("SPRING_SECURITY_CONTEXT");
    } catch (IllegalStateException expired) {
      throw new ApiException(401, "SESSION_EXPIRED", "Your session has expired");
    }
    if (security instanceof org.springframework.security.core.context.SecurityContext context
        && context.getAuthentication() != null
        && context.getAuthentication().getAuthorities().stream()
            .anyMatch(authority -> authority.getAuthority().equals("ROLE_ACCOUNT"))) {
      return context.getAuthentication().getName();
    }
    return null;
  }

  private static HttpServletRequest buffered(HttpServletRequest original, byte[] body) {
    return new HttpServletRequestWrapper(original) {
      @Override
      public ServletInputStream getInputStream() {
        var input = new ByteArrayInputStream(body);
        return new ServletInputStream() {
          @Override
          public int read() {
            return input.read();
          }

          @Override
          public boolean isFinished() {
            return input.available() == 0;
          }

          @Override
          public boolean isReady() {
            return true;
          }

          @Override
          public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException("Synchronous JSON request");
          }
        };
      }

      @Override
      public BufferedReader getReader() {
        return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
      }
    };
  }
}
