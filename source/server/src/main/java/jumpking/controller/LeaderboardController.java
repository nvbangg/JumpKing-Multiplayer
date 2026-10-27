package jumpking.controller;

import java.util.List;
import java.util.Map;
import jumpking.dto.RecordsDto;
import jumpking.network.GameTransport;
import jumpking.service.RecordsService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/leaderboard")
public class LeaderboardController {
  private final RecordsService records;
  private final GameTransport transport;

  public LeaderboardController(RecordsService records, GameTransport transport) {
    this.records = records;
    this.transport = transport;
  }

  @GetMapping
  Map<String, List<RecordsDto.LeaderboardEntry>> leaderboard(
      @RequestParam(defaultValue = "100") int limit,
      jakarta.servlet.http.HttpServletRequest request) {
    transport.publicLookup(request.getRemoteAddr());
    return Map.of("entries", records.leaderboard(limit));
  }
}
