package jumpking.controller;

import java.util.Map;
import jumpking.security.IdentityContext;
import jumpking.service.RecordsService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/community")
public class CommunityController {
  private final RecordsService records;
  private final IdentityContext identities;

  public CommunityController(RecordsService records, IdentityContext identities) {
    this.records = records;
    this.identities = identities;
  }

  @GetMapping("/current")
  Map<String, Object> current() {
    return records.currentCommunity(Long.parseLong(identities.requireAccount().id()));
  }
}
