package jumpking.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import jumpking.entity.PlayRun;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface PlayRunRepository extends JpaRepository<PlayRun, String> {
  boolean existsByUserIdAndKind(long userId, String kind);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select r from PlayRun r where r.id = :id")
  Optional<PlayRun> lockById(@Param("id") String id);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "select r from PlayRun r where r.userId = :owner and r.kind = 'COMMUNITY' and r.status = 'ACTIVE'")
  Optional<PlayRun> lockActiveCommunity(@Param("owner") long owner);

  List<PlayRun> findByMatchId(String matchId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select r from PlayRun r where r.matchId = :id order by r.id")
  List<PlayRun> lockByMatchId(@Param("id") String id);
}
