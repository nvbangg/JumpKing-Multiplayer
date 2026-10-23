package jumpking.entity;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "users")
public class User {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id")
  private Long id;

  @Column(name = "username", length = 32, nullable = false)
  private String username;

  @Column(name = "password_hash", length = 255)
  private String passwordHash;

  @Column(name = "google_id", length = 64)
  private String googleId;

  @Column(name = "crown_unlocked", nullable = false, columnDefinition = "boolean")
  private boolean crownUnlocked;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", columnDefinition = "datetime(3)")
  private Instant createdAt;

  protected User() {}

  public static User account(String username, String passwordHash, Instant created) {
    var user = new User();
    user.username = username;
    user.passwordHash = passwordHash;
    user.createdAt = created;
    return user;
  }

  public static User googleAccount(String username, String googleId, Instant created) {
    var user = new User();
    user.username = username;
    user.googleId = googleId;
    user.createdAt = created;
    return user;
  }

  public Long getId() {
    return id;
  }

  public String getUsername() {
    return username;
  }

  public void setUsername(String value) {
    username = value;
  }

  public String getPasswordHash() {
    return passwordHash;
  }

  public void setPasswordHash(String value) {
    passwordHash = value;
  }

  public String getGoogleId() {
    return googleId;
  }

  public void setGoogleId(String value) {
    googleId = value;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public boolean isCrownUnlocked() {
    return crownUnlocked;
  }

  public void setCrownUnlocked(boolean value) {
    crownUnlocked = value;
  }

  public void setCreatedAt(Instant value) {
    createdAt = value;
  }
}
