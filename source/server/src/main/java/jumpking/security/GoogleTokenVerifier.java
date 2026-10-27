package jumpking.security;

public interface GoogleTokenVerifier {
  record Profile(String googleId, String email, String name) {}

  Profile verify(String idToken);
}
