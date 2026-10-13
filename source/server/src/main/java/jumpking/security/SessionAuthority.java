package jumpking.security;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionIdListener;
import jakarta.servlet.http.HttpSessionListener;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import jumpking.config.SecuritySettings;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class SessionAuthority implements HttpSessionListener, HttpSessionIdListener {
  public record Revoked(String sessionId) {}

  private record Entry(HttpSession session, long created, long activity) {}

  private final ConcurrentHashMap<String, Entry> sessions = new ConcurrentHashMap<>();
  private final Clock clock;
  private final long idleMs, absoluteMs;
  private final ApplicationEventPublisher events;

  public SessionAuthority(
      Clock clock,
      SecuritySettings settings,
      ServerProperties server,
      ApplicationEventPublisher events) {
    this.clock = clock;
    this.events = events;
    Duration idle = server.getServlet().getSession().getTimeout();
    if (idle == null || idle.isZero() || idle.isNegative())
      throw new IllegalArgumentException("A positive session idle timeout is required");
    idleMs = idle.toMillis();
    absoluteMs = settings.sessionAbsoluteTimeout().toMillis();
  }

  @Override
  public void sessionCreated(HttpSessionEvent event) {
    HttpSession session = event.getSession();
    long now = clock.millis();
    // Timeout container là dự phòng; HTTP và WS dùng cùng idle clock bên dưới.
    session.setMaxInactiveInterval((int) (absoluteMs / 1000 + 60));
    sessions.put(session.getId(), new Entry(session, now, now));
  }

  @Override
  public void sessionDestroyed(HttpSessionEvent event) {
    String id = event.getSession().getId();
    sessions.remove(id);
    events.publishEvent(new Revoked(id));
  }

  @Override
  public void sessionIdChanged(HttpSessionEvent event, String previousId) {
    Entry entry = sessions.remove(previousId);
    if (entry != null) sessions.put(event.getSession().getId(), entry);
    events.publishEvent(new Revoked(previousId));
  }

  public boolean valid(HttpSession session, boolean activity) {
    if (session == null) return false;
    synchronized (session) {
      try {
        String id = session.getId();
        Entry entry = sessions.get(id);
        long now = clock.millis();
        if (entry == null || now - entry.created >= absoluteMs || now - entry.activity >= idleMs) {
          session.invalidate();
          return false;
        }
        if (activity) sessions.put(id, new Entry(session, entry.created, now));
        return true;
      } catch (IllegalStateException expired) {
        return false;
      }
    }
  }

  public HttpSession find(String id) {
    Entry entry = sessions.get(id);
    return entry != null && valid(entry.session, false) ? entry.session : null;
  }

  public void revokeAccount(String username) {
    for (var entry : java.util.List.copyOf(sessions.values())) {
      try {
        Object value =
            entry.session.getAttribute(
                org.springframework.security.web.context.HttpSessionSecurityContextRepository
                    .SPRING_SECURITY_CONTEXT_KEY);
        if (value instanceof org.springframework.security.core.context.SecurityContext context
            && context.getAuthentication() != null
            && username.equals(context.getAuthentication().getName())) entry.session.invalidate();
      } catch (IllegalStateException expired) {
        /* Phiên đã hết hạn trong lúc duyệt. */
      }
    }
  }

  @Scheduled(fixedDelay = 60_000)
  public void expire() {
    sessions.values().forEach(entry -> valid(entry.session, false));
  }
}
