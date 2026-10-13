package jumpking.controller;

import jakarta.validation.Valid;
import jumpking.dto.SoloMetrics;
import jumpking.exception.ApiException;
import jumpking.security.IdentityContext;
import jumpking.service.SoloMetricsService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SoloMetricsController {
  private final IdentityContext identity;
  private final SoloMetricsService metrics;

  public SoloMetricsController(IdentityContext identity, SoloMetricsService metrics) {
    this.identity = identity;
    this.metrics = metrics;
  }

  @PutMapping("/api/solo/runs/{id}")
  public SoloMetricsService.Ack save(
      @PathVariable String id,
      @Valid @RequestBody SoloMetrics incoming,
      @RequestHeader(value = "X-Account-ID", required = false) String expected) {
    String accountId = identity.requireAccount().id();
    if (expected != null && !expected.equals(accountId))
      throw new ApiException(409, "CONFLICT", "Sign in again to sync this Solo profile");
    return metrics.save(Long.parseLong(accountId), id, incoming);
  }
}
