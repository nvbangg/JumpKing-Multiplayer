package jumpking.security;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.googleapis.auth.oauth2.GooglePublicKeysManager;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.client.json.webtoken.JsonWebSignature;
import java.io.IOException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.time.Duration;
import java.util.List;
import java.util.function.Consumer;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;

class DefaultGoogleTokenVerifierTest {
  private static final long NOW = 1_800_000_000_000L;
  private final GsonFactory json = GsonFactory.getDefaultInstance();
  private final KeyPair keys;
  private final GooglePublicKeysManager publicKeys = mock(GooglePublicKeysManager.class);
  private final DefaultGoogleTokenVerifier verifier;

  DefaultGoogleTokenVerifierTest() throws Exception {
    var generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    keys = generator.generateKeyPair();
    when(publicKeys.getJsonFactory()).thenReturn(json);
    when(publicKeys.getPublicKeys()).thenReturn(List.of(keys.getPublic()));
    verifier =
        new DefaultGoogleTokenVerifier(
            new GoogleIdTokenVerifier.Builder(publicKeys)
                .setAudience(List.of("expected-client-id"))
                .setClock(() -> NOW)
                .setAcceptableTimeSkewSeconds(0)
                .build());
  }

  private String token(Consumer<GoogleIdToken.Payload> change) throws Exception {
    var payload = new GoogleIdToken.Payload();
    payload.setSubject("google-user-123");
    payload.setIssuer("https://accounts.google.com");
    payload.setAudience("expected-client-id");
    payload.setIssuedAtTimeSeconds(NOW / 1000 - 60);
    payload.setExpirationTimeSeconds(NOW / 1000 + 3600);
    payload.setEmail("user@gmail.com");
    payload.set("name", "Jump King");
    change.accept(payload);
    return JsonWebSignature.signUsingRsaSha256(
        (RSAPrivateKey) keys.getPrivate(),
        json,
        new JsonWebSignature.Header().setAlgorithm("RS256"),
        payload);
  }

  @Test
  void acceptsSignedGoogleTokenForConfiguredAudience() throws Exception {
    var profile = verifier.verify(token(payload -> {}));
    assertThat(profile.googleId()).isEqualTo("google-user-123");
    assertThat(profile.email()).isEqualTo("user@gmail.com");
    assertThat(profile.name()).isEqualTo("Jump King");
  }

  @Test
  void rejectsWrongAudienceIssuerExpirySubjectAndSignature() throws Exception {
    for (Consumer<GoogleIdToken.Payload> change :
        List.<Consumer<GoogleIdToken.Payload>>of(
            payload -> payload.setAudience("another-client"),
            payload -> payload.setIssuer("https://example.com"),
            payload -> payload.setExpirationTimeSeconds(NOW / 1000 - 1),
            payload -> payload.setExpirationTimeSeconds(null),
            payload -> payload.setIssuedAtTimeSeconds(null),
            payload -> payload.setAudience(null),
            payload -> payload.setSubject(null))) {
      String invalid = token(change);
      assertThatThrownBy(() -> verifier.verify(invalid))
          .isInstanceOfSatisfying(
              ApiException.class, error -> assertThat(error.status()).isEqualTo(401));
    }
    String valid = token(payload -> {});
    when(publicKeys.getPublicKeys())
        .thenReturn(List.of(KeyPairGenerator.getInstance("RSA").generateKeyPair().getPublic()));
    assertThatThrownBy(() -> verifier.verify(valid))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.status()).isEqualTo(401));
  }

  @Test
  void rejectsMalformedTokensAndDisabledProviderWithoutFetchingKeys() throws Exception {
    for (String value : List.of("", " ", "not-a-jwt", "a.b.c")) {
      assertThatThrownBy(() -> verifier.verify(value))
          .isInstanceOfSatisfying(
              ApiException.class, error -> assertThat(error.status()).isEqualTo(401));
    }
    verify(publicKeys, never()).getPublicKeys();
    var settings =
        new SecuritySettings(
            List.of("https://example.com"), Duration.ofDays(30), 20, 16384, 10000, " ");
    assertThat(settings.googleClientId()).isNull();
    assertThatThrownBy(() -> new DefaultGoogleTokenVerifier(settings).verify("any-token"))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.status()).isEqualTo(503));
  }

  @Test
  void reportsKeyServiceFailureWithoutAcceptingToken() throws Exception {
    String valid = token(payload -> {});
    when(publicKeys.getPublicKeys()).thenThrow(new IOException("key service unavailable"));
    assertThatThrownBy(() -> verifier.verify(valid))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.status()).isEqualTo(503));
  }
}
