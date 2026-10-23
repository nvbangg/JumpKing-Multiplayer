package jumpking.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class DefaultGoogleTokenVerifier implements GoogleTokenVerifier {
  private final SecuritySettings settings;
  private final ObjectMapper json;
  private final HttpClient http;

  @Autowired
  public DefaultGoogleTokenVerifier(SecuritySettings settings, ObjectMapper json) {
    this(settings, json, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
  }

  public DefaultGoogleTokenVerifier(SecuritySettings settings, ObjectMapper json, HttpClient http) {
    this.settings = settings;
    this.json = json;
    this.http = http;
  }

  @Override
  public Profile verify(String idToken) {
    if (idToken == null || idToken.isBlank()) {
      throw new ApiException(401, "INVALID_CREDENTIALS", "Google ID token is required");
    }
    try {
      var request =
          HttpRequest.newBuilder()
              .uri(
                  URI.create(
                      "https://oauth2.googleapis.com/tokeninfo?id_token="
                          + URLEncoder.encode(idToken, StandardCharsets.UTF_8)))
              .timeout(Duration.ofSeconds(6))
              .GET()
              .build();
      var response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() != 200) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Google ID token is invalid");
      }
      JsonNode node = json.readTree(response.body());
      String sub = node.path("sub").asText(null);
      if (sub == null || sub.isBlank()) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Missing subject in Google token");
      }

      String aud = node.path("aud").asText(null);
      if (settings.googleClientId() != null
          && !settings.googleClientId().isBlank()
          && !settings.googleClientId().equals(aud)) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Google token audience mismatch");
      }

      String iss = node.path("iss").asText("");
      if (!"accounts.google.com".equals(iss) && !"https://accounts.google.com".equals(iss)) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Google token issuer invalid");
      }

      long exp = node.path("exp").asLong(0);
      if (exp > 0 && Instant.ofEpochSecond(exp).isBefore(Instant.now())) {
        throw new ApiException(401, "INVALID_CREDENTIALS", "Google token has expired");
      }

      String email = node.path("email").asText(null);
      String name = node.path("name").asText(null);
      return new Profile(sub, email, name);
    } catch (ApiException e) {
      throw e;
    } catch (IOException | InterruptedException e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      throw new ApiException(503, "SERVICE_UNAVAILABLE", "Failed to verify Google token");
    }
  }
}
