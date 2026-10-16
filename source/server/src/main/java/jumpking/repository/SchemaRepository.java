package jumpking.repository;

import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Repository;

/** Hibernate kiểm tra mapping; phần này kiểm tra những constraints không nằm trong mapping. */
@Repository
public class SchemaRepository {
  private final EntityManager entityManager;

  public SchemaRepository(EntityManager entityManager) {
    this.entityManager = entityManager;
  }

  public void validate() {
    require(
        names(
                "SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_type='CHECK' AND enforced='YES'")
            .containsAll(
                Set.of(
                    "ck_matches_mode",
                    "ck_matches_map_level",
                    "ck_matches_ticks",
                    "ck_matches_end",
                    "ck_runs_kind",
                    "ck_runs_counters",
                    "ck_runs_end",
                    "ck_runs_finish",
                    "ck_runs_snapshot",
                    "ck_runs_rank",
                    "ck_runs_winner")),
        "Required enforced CHECK constraints missing");
    require(
        names(
                "SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0")
            .containsAll(
                Set.of("uq_users_username", "uq_active_community_user", "uq_runs_match_user")),
        "Required unique indexes missing");
    require(
        names(
                "SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND delete_rule IN ('RESTRICT','NO ACTION')")
            .containsAll(Set.of("fk_runs_user", "fk_runs_match")),
        "Required restrictive foreign keys missing");
    require(
        count(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('users','matches','play_runs') AND engine='InnoDB'")
            == 3,
        "InnoDB required");
    require(
        count(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='play_runs' AND column_name='active_community_user_id' AND extra LIKE '%GENERATED%' AND generation_expression LIKE '%COMMUNITY%'")
            == 1,
        "Community unique generated column missing");
    require(
        names(
                "SELECT CONCAT(index_name,':',GROUP_CONCAT(column_name ORDER BY seq_in_index)) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='play_runs' GROUP BY index_name")
            .containsAll(
                Set.of(
                    "ix_runs_owner_history:user_id,ended_at,id",
                    "uq_runs_match_user:match_id,user_id",
                    "ix_runs_leaderboard:kind,status")),
        "Records indexes differ");
  }

  private Set<String> names(String sql) {
    return ((List<?>) entityManager.createNativeQuery(sql).getResultList())
        .stream().map(String.class::cast).collect(Collectors.toSet());
  }

  private long count(String sql) {
    return ((Number) entityManager.createNativeQuery(sql).getSingleResult()).longValue();
  }

  private static void require(boolean valid, String message) {
    if (!valid)
      throw new IllegalStateException(
          "Database schema is incompatible: "
              + message
              + ". Review source/database/schema.sql; no automatic changes were applied.");
  }
}
