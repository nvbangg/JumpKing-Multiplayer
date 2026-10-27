package jumpking.security;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.List;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class DefaultGoogleTokenVerifier implements GoogleTokenVerifier {
  private static final org.slf4j.Logger log =
      org.slf4j.LoggerFactory.getLogger(DefaultGoogleTokenVerifier.class);
  private final GoogleIdTokenVerifier verifier;

  @Autowired
  public DefaultGoogleTokenVerifier(SecuritySettings settings) {
    this(
        settings.googleClientId() == null
            ? null
            : new GoogleIdTokenVerifier.Builder(
                    new NetHttpTransport(), GsonFactory.getDefaultInstance())
                .setAudience(List.of(settings.googleClientId()))
                .build());
  }

  DefaultGoogleTokenVerifier(GoogleIdTokenVerifier verifier) {
    this.verifier = verifier;
  }

  @Override
  public Profile verify(String idToken) {
    if (verifier == null)
      throw new ApiException(503, "SERVICE_UNAVAILABLE", "Google Sign-In is not configured");
    if (idToken == null || idToken.isBlank()) throw invalid();
    GoogleIdToken token;
    try {
      token = GoogleIdToken.parse(verifier.getJsonFactory(), idToken);
    } catch (IOException | IllegalArgumentException malformed) {
      throw invalid();
    }
    try {
      var payload = token.getPayload();
      if (payload.getSubject() == null
          || payload.getSubject().isBlank()
          || payload.getExpirationTimeSeconds() == null
          || payload.getIssuedAtTimeSeconds() == null
          || !verifier.verify(token)) throw invalid();
      return new Profile(payload.getSubject(), payload.getEmail(), (String) payload.get("name"));
    } catch (IOException | GeneralSecurityException unavailable) {
      log.warn("Google signing keys are unavailable", unavailable);
      throw new ApiException(503, "SERVICE_UNAVAILABLE", "Unable to verify Google token");
    }
  }

  private static ApiException invalid() {
    return new ApiException(401, "INVALID_CREDENTIALS", "Google ID token is invalid");
  }
}
