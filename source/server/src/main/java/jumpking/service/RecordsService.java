package jumpking.service;

import static jumpking.dto.RecordsDto.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import jumpking.exception.ApiException;
import jumpking.repository.MatchRepository;
import jumpking.repository.RecordsRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class RecordsService {
  private final RecordsRepository records;
  private final MatchRepository matches;
  private final ObjectMapper json;

  public RecordsService(RecordsRepository records, MatchRepository matches, ObjectMapper json) {
    this.records = records;
    this.matches = matches;
    this.json = json;
  }

  public Statistics statistics(long owner) {
    return records.statistics(owner);
  }

  public Page history(long owner, int page, int size) {
    if (page < 0 || page > 100_000 || size < 1 || size > 100)
      throw new ApiException(400, "VALIDATION", "Invalid page bounds");
    var rows = records.history(owner, page * size, size + 1);
    return new Page(
        List.copyOf(rows.subList(0, Math.min(rows.size(), size))), page, size, rows.size() > size);
  }

  public ObjectNode detail(long owner, String kind, String id) {
    if (!List.of("COMMUNITY", "ROOM").contains(kind))
      throw new ApiException(400, "VALIDATION", "Invalid history kind");
    var history =
        records
            .detail(owner, kind, id)
            .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "History not found"));
    ObjectNode detail = json.valueToTree(history);
    if (kind.equals("ROOM")) {
      var match = matches.findById(id).orElseThrow();
      if (match.getTimeLimitMinutes() == null) detail.putNull("timeLimitMinutes");
      else detail.put("timeLimitMinutes", match.getTimeLimitMinutes());
      detail.put("endReason", match.getEndReason());
      detail.set("participants", json.valueToTree(records.participants(id)));
    }
    return detail;
  }

  public List<LeaderboardEntry> leaderboard(int limit) {
    if (limit < 1 || limit > 100)
      throw new ApiException(400, "VALIDATION", "Invalid leaderboard limit");
    return records.leaderboard(limit);
  }

  public Map<String, Object> currentCommunity(long owner) {
    return records.currentCommunity(owner);
  }
}
