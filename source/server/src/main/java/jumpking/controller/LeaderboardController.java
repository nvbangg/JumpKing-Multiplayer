package jumpking.controller;

import java.util.List;
import java.util.Map;
import jumpking.dto.RecordsDto;
import jumpking.service.RecordsService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/leaderboard")
public class LeaderboardController {
  private final RecordsService records;

  public LeaderboardController(RecordsService records) {
    this.records = records;
  }

  @GetMapping
  Map<String, List<RecordsDto.LeaderboardEntry>> leaderboard(
      @RequestParam(defaultValue = "100") int limit) {
    return Map.of("entries", records.leaderboard(limit));
  }
}
