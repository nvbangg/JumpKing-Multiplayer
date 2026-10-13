package jumpking.config;

import java.util.Map;
import jumpking.exception.ApiException;
import jumpking.network.*;
import jumpking.security.IdentityContext;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.*;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.server.HandshakeInterceptor;

@Configuration(proxyBeanMethods = false)
@EnableWebSocket
@EnableConfigurationProperties(NetworkSettings.class)
public class GameWebSocketConfiguration implements WebSocketConfigurer {
  private final GameTransport transport;
  private final SecuritySettings security;
  private final IdentityContext identities;

  public GameWebSocketConfiguration(
      GameTransport transport, SecuritySettings security, IdentityContext identities) {
    this.transport = transport;
    this.security = security;
    this.identities = identities;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry
        .addHandler(transport, "/ws/game")
        .setAllowedOrigins(security.allowedOrigins().toArray(String[]::new))
        .addInterceptors(
            new HandshakeInterceptor() {
              @Override
              public boolean beforeHandshake(
                  ServerHttpRequest request,
                  ServerHttpResponse response,
                  WebSocketHandler handler,
                  Map<String, Object> attributes) {
                try {
                  var servlet = ((ServletServerHttpRequest) request).getServletRequest();
                  String ip = servlet.getRemoteAddr();
                  transport.handshakeAttempt(ip);
                  if (!security.acceptsOrigin(servlet.getHeader("Origin")))
                    throw new ApiException(403, "ORIGIN_DENIED", "Origin is not allowed");
                  var account = identities.account();
                  if (account == null)
                    throw new ApiException(401, "AUTH_REQUIRED", "Sign in to connect");
                  var session = servlet.getSession(false);
                  var identity =
                      new GameConnection.Identity(
                          Long.parseLong(account.id()), account.username(), session.getId(), ip);
                  attributes.put(GameTransport.IDENTITY, identity);
                  attributes.put("reservation", transport.reserve(identity));
                  return true;
                } catch (ApiException error) {
                  response.setStatusCode(HttpStatus.valueOf(error.status()));
                  return false;
                }
              }

              @Override
              public void afterHandshake(
                  ServerHttpRequest request,
                  ServerHttpResponse response,
                  WebSocketHandler handler,
                  Exception exception) {}
            });
  }
}
