package jumpking.repository;

import static jumpking.dto.RecordsDto.*;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import jumpking.game.SharedData;
import org.springframework.stereotype.Repository;

/** Projection chỉ chọn metrics công khai; không nạp snapshot hoặc credentials. */
@Repository
public class RecordsRepository {
  private final EntityManager entityManager;
  private final int tickRate;

  public RecordsRepository(EntityManager entityManager, SharedData shared) {
    this.entityManager = entityManager;
    tickRate = shared.tuning().tickRate;
  }

  // Sau Merge, một owner có thể có nhiều lượt cùng match: History chỉ chọn một dòng đại diện.
  private static final String HISTORY =
      """
        WITH owned_rooms AS (
          SELECT p.status,p.play_ticks,p.jumps,p.falls,p.current_progress,p.max_progress,p.finish_ticks,p.`rank`,p.is_winner,
            m.id,m.started_at,m.ended_at,m.mode,m.map_level,m.room_code,m.duration_ticks,
            ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY p.`rank`,p.id) AS choice
          FROM play_runs p JOIN matches m ON m.id=p.match_id WHERE p.user_id=:owner AND p.kind='ROOM' AND m.ended_at IS NOT NULL
        ), history AS (
          SELECT id,kind,status,started_at,ended_at,play_ticks,jumps,falls,current_progress,max_progress,finish_ticks,
            NULL AS mode,NULL AS map_level,NULL AS room_code,NULL AS duration_ticks,NULL AS `rank`,FALSE AS is_winner
          FROM play_runs WHERE user_id=:owner AND kind IN ('SOLO','COMMUNITY') AND status<>'ACTIVE'
          UNION ALL
          SELECT id,'ROOM',status,started_at,ended_at,play_ticks,jumps,falls,current_progress,max_progress,finish_ticks,
            mode,map_level,room_code,duration_ticks,`rank`,is_winner FROM owned_rooms WHERE choice=1
        ) SELECT * FROM history
        """;

  public Statistics statistics(long owner) {
    var row =
        (Tuple)
            entityManager
                .createNativeQuery(
                    """
            SELECT COALESCE(SUM(play_ticks),0) AS ticks,COALESCE(SUM(jumps),0) AS jumps,COALESCE(SUM(falls),0) AS falls,
              COALESCE(SUM(status='FINISHED'),0) AS finishes,MIN(CASE WHEN kind<>'ROOM' OR m.map_level=10 THEN finish_ticks END) AS best,
              COUNT(DISTINCT CASE WHEN kind='ROOM' THEN match_id END) AS matches,
              COUNT(DISTINCT CASE WHEN kind='ROOM' AND is_winner=TRUE THEN match_id END) AS wins
            FROM play_runs p LEFT JOIN matches m ON m.id=p.match_id WHERE p.user_id=:owner
            """,
                    Tuple.class)
                .setParameter("owner", owner)
                .getSingleResult();
    var ticks = new BigDecimal(row.get("ticks").toString()).toBigIntegerExact();
    return new Statistics(
        ticks.multiply(BigInteger.valueOf(1000)).divide(BigInteger.valueOf(tickRate)),
        number(row, "jumps"),
        number(row, "falls"),
        number(row, "finishes"),
        number(row, "matches"),
        number(row, "wins"),
        optionalMs(row, "best"));
  }

  public List<History> history(long owner, int offset, int limit) {
    return rows(
            entityManager
                .createNativeQuery(
                    HISTORY + " ORDER BY ended_at DESC,kind,id DESC LIMIT :maximum OFFSET :offset",
                    Tuple.class)
                .setParameter("owner", owner)
                .setParameter("maximum", limit)
                .setParameter("offset", offset))
        .stream()
        .map(this::historyRow)
        .toList();
  }

  public Optional<History> detail(long owner, String kind, String id) {
    return rows(
            entityManager
                .createNativeQuery(HISTORY + " WHERE kind=:kind AND id=:id", Tuple.class)
                .setParameter("owner", owner)
                .setParameter("kind", kind)
                .setParameter("id", id))
        .stream()
        .map(this::historyRow)
        .findFirst();
  }

  public List<Participant> participants(String id) {
    return rows(
            entityManager
                .createNativeQuery(
                    """
            SELECT id,nickname,status,`rank`,is_winner,current_progress,max_progress,finish_ticks,play_ticks,jumps,falls
            FROM play_runs WHERE match_id=:id ORDER BY `rank`,id
            """,
                    Tuple.class)
                .setParameter("id", id))
        .stream()
        .map(
            row ->
                new Participant(
                    text(row, "id"),
                    text(row, "nickname"),
                    text(row, "status"),
                    integer(row, "rank"),
                    bool(row, "is_winner"),
                    decimal(row, "current_progress"),
                    decimal(row, "max_progress"),
                    optionalMs(row, "finish_ticks"),
                    ms(number(row, "play_ticks")),
                    (int) number(row, "jumps"),
                    (int) number(row, "falls")))
        .toList();
  }

  public List<LeaderboardEntry> leaderboard(int maximum) {
    // Chọn best run từng Account, tính đồng hạng trên toàn bộ rồi mới LIMIT.
    return rows(
            entityManager
                .createNativeQuery(
                    """
            WITH ordered_runs AS (
              SELECT r.id,u.username,r.status,r.current_progress,r.max_progress,r.play_ticks,r.peak_reached_ticks,r.finish_ticks,
                ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY (r.status='FINISHED') DESC,
                  CASE WHEN r.status='FINISHED' THEN r.finish_ticks END,
                  CASE WHEN r.status<>'FINISHED' THEN r.max_progress END DESC,
                  CASE WHEN r.status<>'FINISHED' THEN r.peak_reached_ticks END,r.id) AS best
              FROM play_runs r JOIN users u ON u.id=r.user_id WHERE r.kind='COMMUNITY' AND u.type='ACCOUNT'
            ), ranked AS (
              SELECT id,username,status,current_progress,max_progress,play_ticks,peak_reached_ticks,finish_ticks,
                RANK() OVER (ORDER BY (status='FINISHED') DESC,CASE WHEN status='FINISHED' THEN finish_ticks END,
                  CASE WHEN status<>'FINISHED' THEN max_progress END DESC,
                  CASE WHEN status<>'FINISHED' THEN peak_reached_ticks END) AS position
              FROM ordered_runs WHERE best=1
            ) SELECT * FROM ranked ORDER BY position,id LIMIT :maximum
            """,
                    Tuple.class)
                .setParameter("maximum", maximum))
        .stream()
        .map(
            row ->
                new LeaderboardEntry(
                    text(row, "id"),
                    number(row, "position"),
                    text(row, "username"),
                    text(row, "status"),
                    decimal(row, "current_progress"),
                    decimal(row, "max_progress"),
                    ms(number(row, "play_ticks")),
                    ms(number(row, "peak_reached_ticks")),
                    optionalMs(row, "finish_ticks")))
        .toList();
  }

  public Map<String, Object> currentCommunity(long owner) {
    var rows =
        rows(
            entityManager
                .createNativeQuery(
                    """
            SELECT id,status,current_progress,max_progress,play_ticks,peak_reached_ticks,updated_at
            FROM play_runs WHERE user_id=:owner AND kind='COMMUNITY' AND status='ACTIVE'
            """,
                    Tuple.class)
                .setParameter("owner", owner));
    var result = new LinkedHashMap<String, Object>();
    if (rows.isEmpty()) {
      result.put("run", null);
      result.put("updatedAt", null);
    } else {
      var row = rows.getFirst();
      var run = new LinkedHashMap<String, Object>();
      run.put("id", text(row, "id"));
      run.put("status", text(row, "status"));
      run.put("currentProgress", decimal(row, "current_progress"));
      run.put("maxProgress", decimal(row, "max_progress"));
      run.put("elapsedTimeMs", ms(number(row, "play_ticks")));
      run.put("peakReachedTimeMs", ms(number(row, "peak_reached_ticks")));
      run.put("finishTimeMs", null);
      result.put("run", run);
      result.put("updatedAt", instant(row, "updated_at"));
    }
    result.put("saveStatus", "SAVED");
    return result;
  }

  private History historyRow(Tuple row) {
    return new History(
        text(row, "id"),
        text(row, "kind"),
        instant(row, "started_at"),
        instant(row, "ended_at"),
        text(row, "status"),
        ms(number(row, "play_ticks")),
        (int) number(row, "jumps"),
        (int) number(row, "falls"),
        decimal(row, "current_progress"),
        decimal(row, "max_progress"),
        optionalMs(row, "finish_ticks"),
        text(row, "kind").equals("ROOM")
            ? new Room(
                text(row, "mode"),
                integer(row, "map_level"),
                text(row, "room_code"),
                ms(number(row, "duration_ticks")),
                integer(row, "rank"),
                bool(row, "is_winner"))
            : null);
  }

  private static List<Tuple> rows(Query query) {
    return ((List<?>) query.getResultList()).stream().map(Tuple.class::cast).toList();
  }

  private static String text(Tuple row, String key) {
    return (String) row.get(key);
  }

  private static long number(Tuple row, String key) {
    return ((Number) row.get(key)).longValue();
  }

  private static double decimal(Tuple row, String key) {
    return ((Number) row.get(key)).doubleValue();
  }

  private static Integer integer(Tuple row, String key) {
    return row.get(key) == null ? null : ((Number) row.get(key)).intValue();
  }

  private static boolean bool(Tuple row, String key) {
    var value = row.get(key);
    return Boolean.TRUE.equals(value) || value instanceof Number n && n.intValue() != 0;
  }

  private static Instant instant(Tuple row, String key) {
    var value = row.get(key);
    if (value == null) return null;
    if (value instanceof Instant time) return time;
    if (value instanceof Timestamp time) return time.toInstant();
    return ((java.time.LocalDateTime) value).toInstant(java.time.ZoneOffset.UTC);
  }

  private long ms(long ticks) {
    return Math.addExact(
        Math.multiplyExact(ticks / tickRate, 1000), ticks % tickRate * 1000 / tickRate);
  }

  private Long optionalMs(Tuple row, String key) {
    return row.get(key) == null ? null : ms(number(row, key));
  }
}
