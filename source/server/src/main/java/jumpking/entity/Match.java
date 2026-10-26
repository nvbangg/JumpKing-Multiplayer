package jumpking.entity;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "matches")
public class Match {
  @Id
  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "id", length = 36)
  private String id;

  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "room_code", length = 6)
  private String roomCode;

  @Column(name = "mode", length = 16)
  private String mode;

  @Column(name = "map_id", columnDefinition = "smallint", nullable = false)
  private int mapId;

  @Column(name = "time_limit_minutes", columnDefinition = "smallint")
  private Integer timeLimitMinutes;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "started_at", columnDefinition = "datetime(3)")
  private Instant startedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "ended_at", columnDefinition = "datetime(3)")
  private Instant endedAt;

  @Column(name = "duration_ticks")
  private long durationTicks;

  @Column(name = "end_reason", length = 32)
  private String endReason;

  @Column(name = "item_cooldown_minutes", columnDefinition = "smallint")
  private Integer itemCooldownMinutes;

  public Match() {}

  public String getId() {
    return id;
  }

  public void setId(String value) {
    id = value;
  }

  public String getRoomCode() {
    return roomCode;
  }

  public void setRoomCode(String value) {
    roomCode = value;
  }

  public int getMapId() {
    return mapId;
  }

  public void setMapId(int value) {
    mapId = value;
  }

  public Integer getItemCooldownMinutes() {
    return itemCooldownMinutes;
  }

  public void setItemCooldownMinutes(Integer value) {
    itemCooldownMinutes = value;
  }

  public String getMode() {
    return mode;
  }

  public void setMode(String value) {
    mode = value;
  }

  public Integer getTimeLimitMinutes() {
    return timeLimitMinutes;
  }

  public void setTimeLimitMinutes(Integer value) {
    timeLimitMinutes = value;
  }

  public Instant getStartedAt() {
    return startedAt;
  }

  public void setStartedAt(Instant value) {
    startedAt = value;
  }

  public Instant getEndedAt() {
    return endedAt;
  }

  public void setEndedAt(Instant value) {
    endedAt = value;
  }

  public long getDurationTicks() {
    return durationTicks;
  }

  public void setDurationTicks(long value) {
    durationTicks = value;
  }

  public String getEndReason() {
    return endReason;
  }

  public void setEndReason(String value) {
    endReason = value;
  }
}
