package jumpking.controller;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import jumpking.exception.ApiException;
import jumpking.network.GameTransport;
import jumpking.room.RoomDirectory;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class RoomLookupControllerTest {
  @Test
  void leadingZerosArePreservedWhenLookingUpARoom() {
    var directory = mock(RoomDirectory.class);
    var controller = new RoomLookupController(directory, mock(GameTransport.class));
    var expected = new RoomDirectory.Info("001234", "ROOM", true);
    when(directory.find("001234")).thenReturn(expected);

    assertThat(controller.lookup("001234", new MockHttpServletRequest())).isEqualTo(expected);
    verify(directory).find("001234");
  }

  @Test
  void roomLookupRejectsNonNumericOrIncorrectLengthCodes() {
    var directory = mock(RoomDirectory.class);
    var controller = new RoomLookupController(directory, mock(GameTransport.class));
    for (String id : new String[] {"ABCDEF", "12345", "1234567", "12.345", "１２３４５６"}) {
      assertThatThrownBy(() -> controller.lookup(id, new MockHttpServletRequest()))
          .isInstanceOfSatisfying(
              ApiException.class,
              error -> {
                assertThat(error.status()).isEqualTo(400);
                assertThat(error.code()).isEqualTo("VALIDATION");
              });
    }
    verifyNoInteractions(directory);
  }
}
