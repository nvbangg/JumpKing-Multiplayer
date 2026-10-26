package jumpking.entity;

import jakarta.persistence.*;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "play_runs")
public class PlayRun {
  @Id
  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "id", length = 36)
  private String id;

  @Column(name = "user_id")
  private long userId;

  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "match_id", length = 36)
  private String matchId;

  @Column(name = "status", length = 16)
  private String status;

  @Column(name = "play_ticks")
  private long playTicks;

  @Column(name = "jumps")
  private int jumps;

  @Column(name = "falls")
  private int falls;

  @Column(name = "current_progress")
  private double currentProgress;

  @Column(name = "max_progress")
  private double maxProgress;

  @Column(name = "peak_reached_ticks")
  private long peakReachedTicks;

  @Column(name = "finish_ticks")
  private Long finishTicks;

  @JdbcTypeCode(SqlTypes.TINYINT)
  @Column(name = "`rank`")
  private Integer rank;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "snapshot", columnDefinition = "json")
  private String snapshot;

  @Column(name = "revision")
  private long revision;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "started_at", columnDefinition = "datetime(3)")
  private Instant startedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "updated_at", columnDefinition = "datetime(3)")
  private Instant updatedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "ended_at", columnDefinition = "datetime(3)")
  private Instant endedAt;

  public PlayRun() {}

  public String getId() {
    return id;
  }

  public void setId(String value) {
    id = value;
  }

  public long getUserId() {
    return userId;
  }

  public void setUserId(long value) {
    userId = value;
  }

  public String getMatchId() {
    return matchId;
  }

  public void setMatchId(String value) {
    matchId = value;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String value) {
    status = value;
  }

  public long getPlayTicks() {
    return playTicks;
  }

  public void setPlayTicks(long value) {
    playTicks = value;
  }

  public int getJumps() {
    return jumps;
  }

  public void setJumps(int value) {
    jumps = value;
  }

  public int getFalls() {
    return falls;
  }

  public void setFalls(int value) {
    falls = value;
  }

  public double getCurrentProgress() {
    return currentProgress;
  }

  public void setCurrentProgress(double value) {
    currentProgress = value;
  }

  public double getMaxProgress() {
    return maxProgress;
  }

  public void setMaxProgress(double value) {
    maxProgress = value;
  }

  public long getPeakReachedTicks() {
    return peakReachedTicks;
  }

  public void setPeakReachedTicks(long value) {
    peakReachedTicks = value;
  }

  public Long getFinishTicks() {
    return finishTicks;
  }

  public void setFinishTicks(Long value) {
    finishTicks = value;
  }

  public Integer getRank() {
    return rank;
  }

  public void setRank(Integer value) {
    rank = value;
  }

  public String getSnapshot() {
    return snapshot;
  }

  public void setSnapshot(String value) {
    snapshot = value;
  }

  public long getRevision() {
    return revision;
  }

  public void setRevision(long value) {
    revision = value;
  }

  public Instant getStartedAt() {
    return startedAt;
  }

  public void setStartedAt(Instant value) {
    startedAt = value;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(Instant value) {
    updatedAt = value;
  }

  public Instant getEndedAt() {
    return endedAt;
  }

  public void setEndedAt(Instant value) {
    endedAt = value;
  }
}
