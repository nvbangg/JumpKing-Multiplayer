package jumpking.config;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import jumpking.repository.SchemaRepository;
import jumpking.service.RoomRuns;
import org.junit.jupiter.api.Test;

class StartupChecksTest {
  @Test
  void recoversRoomsOnlyAfterSchemaValidationSucceeds() {
    var schema = mock(SchemaRepository.class);
    var rooms = mock(RoomRuns.class);
    new StartupChecks(schema, rooms).run(null);
    var order = inOrder(schema, rooms);
    order.verify(schema).validate();
    order.verify(rooms).recoverAborted();
  }

  @Test
  void rejectsAnIncompatibleSchemaWithoutUpdatingMatches() {
    var schema = mock(SchemaRepository.class);
    var rooms = mock(RoomRuns.class);
    doThrow(new IllegalStateException("Incompatible schema")).when(schema).validate();
    assertThatThrownBy(() -> new StartupChecks(schema, rooms).run(null))
        .isInstanceOf(IllegalStateException.class);
    verifyNoInteractions(rooms);
  }
}
