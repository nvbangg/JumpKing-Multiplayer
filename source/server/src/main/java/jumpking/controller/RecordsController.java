package jumpking.controller;

import jumpking.dto.RecordsDto;
import jumpking.security.IdentityContext;
import jumpking.service.RecordsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RecordsController {
  private final IdentityContext identity;
  private final RecordsService records;

  public RecordsController(IdentityContext identity, RecordsService records) {
    this.identity = identity;
    this.records = records;
  }

  @GetMapping("/api/profile/me")
  public RecordsDto.Profile profile() {
    var account = identity.requireAccount();
    return new RecordsDto.Profile(
        account.username(), records.statistics(Long.parseLong(account.id())));
  }

  @GetMapping("/api/history")
  public RecordsDto.Page history(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return records.history(Long.parseLong(identity.requireAccount().id()), page, size);
  }

  @GetMapping("/api/history/{kind}/{id}")
  public com.fasterxml.jackson.databind.JsonNode detail(
      @PathVariable String kind, @PathVariable String id) {
    return records.detail(Long.parseLong(identity.requireAccount().id()), kind, id);
  }
}
