package jumpking.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import jumpking.config.SecuritySettings;
import jumpking.exception.ApiException;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class DefaultGoogleTokenVerifierTest {
  private final SecuritySettings settings =
      new SecuritySettings(
          List.of("http://127.0.0.1:5173"),
          Duration.ofDays(30),
          20,
          16384,
          10000,
          "expected-client-id");
  private final ObjectMapper json = new ObjectMapper();

  @Test
  void rejectsBlankToken() {
    var verifier = new DefaultGoogleTokenVerifier(settings, json);
    assertThatThrownBy(() -> verifier.verify("   "))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("Google ID token is required");
  }

  @Test
  @SuppressWarnings("unchecked")
  void verifiesValidTokenSuccessfully() throws Exception {
    HttpClient mockHttp = Mockito.mock(HttpClient.class);
    HttpResponse<String> mockResponse = Mockito.mock(HttpResponse.class);
    Mockito.when(mockResponse.statusCode()).thenReturn(200);
    Mockito.when(mockResponse.body())
        .thenReturn(
            """
            {
              "sub": "google-user-123",
              "email": "user@gmail.com",
              "name": "Jump King",
              "aud": "expected-client-id",
              "iss": "https://accounts.google.com",
              "exp": 9999999999
            }
            """);
    Mockito.doReturn(mockResponse).when(mockHttp).send(Mockito.any(), Mockito.any());

    var verifier = new DefaultGoogleTokenVerifier(settings, json, mockHttp);
    var profile = verifier.verify("valid-test-token");
    assertThat(profile.googleId()).isEqualTo("google-user-123");
    assertThat(profile.email()).isEqualTo("user@gmail.com");
    assertThat(profile.name()).isEqualTo("Jump King");
  }

  @Test
  @SuppressWarnings("unchecked")
  void rejectsMismatchedAudience() throws Exception {
    HttpClient mockHttp = Mockito.mock(HttpClient.class);
    HttpResponse<String> mockResponse = Mockito.mock(HttpResponse.class);
    Mockito.when(mockResponse.statusCode()).thenReturn(200);
    Mockito.when(mockResponse.body())
        .thenReturn(
            """
            {
              "sub": "google-user-123",
              "aud": "wrong-client-id",
              "iss": "https://accounts.google.com",
              "exp": 9999999999
            }
            """);
    Mockito.doReturn(mockResponse).when(mockHttp).send(Mockito.any(), Mockito.any());

    var verifier = new DefaultGoogleTokenVerifier(settings, json, mockHttp);
    assertThatThrownBy(() -> verifier.verify("token-wrong-audience"))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("Google token audience mismatch");
  }
}
