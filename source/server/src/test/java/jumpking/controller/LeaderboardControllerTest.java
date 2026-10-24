package jumpking.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.util.List;
import jumpking.exception.ApiException;
import jumpking.network.GameTransport;
import jumpking.service.RecordsService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class LeaderboardControllerTest {
  @Test
  void checksPublicReadQuotaBeforeQueryingLeaderboard() {
    var records = mock(RecordsService.class);
    var transport = mock(GameTransport.class);
    var controller = new LeaderboardController(records, transport);
    var request = new MockHttpServletRequest();
    request.setRemoteAddr("192.0.2.1");
    when(records.leaderboard(10)).thenReturn(List.of());
    assertThat(controller.leaderboard(10, request).get("entries")).isEmpty();
    var order = inOrder(transport, records);
    order.verify(transport).publicLookup("192.0.2.1");
    order.verify(records).leaderboard(10);
  }

  @Test
  void exhaustedQuotaDoesNotRunDatabaseQuery() {
    var records = mock(RecordsService.class);
    var transport = mock(GameTransport.class);
    var controller = new LeaderboardController(records, transport);
    var request = new MockHttpServletRequest();
    doThrow(new ApiException(429, "RATE_LIMITED", "Read limit exceeded"))
        .when(transport)
        .publicLookup(request.getRemoteAddr());
    assertThatThrownBy(() -> controller.leaderboard(100, request)).isInstanceOf(ApiException.class);
    verifyNoInteractions(records);
  }
}
