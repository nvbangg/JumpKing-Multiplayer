package jumpking.room;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import jumpking.config.NetworkSettings;
import jumpking.exception.ApiException;
import jumpking.game.SharedData;
import org.junit.jupiter.api.Test;

class RoomDirectoryTest {
  private RoomDirectory directory() throws Exception {
    var limits =
        new NetworkSettings(
            30, 2, 32, 256, 64, 20, 16384, 120, 120, 4, 240, 4, 8, 5000, 30000, 500, 60, 200, 50,
            1000);
    return new RoomDirectory(new SharedData(new ObjectMapper()), limits);
  }

  @Test
  void listOnlyIncludesPublicJoinableRoomsWithAvailableSlots() throws Exception {
    var directory = directory();
    var privateRoom = directory.createRoom();
    var publicRoom = directory.createRoom();
    directory.community();
    assertThat(directory.publicRooms()).isEmpty();
    directory.describeRoom(publicRoom.roomId(), "PUBLIC", "HARDCORE", 10);
    assertThat(directory.publicRooms())
        .extracting(RoomDirectory.PublicRoom::roomId)
        .containsExactly(publicRoom.roomId());
    assertThat(directory.find(privateRoom.roomId()).joinable()).isTrue();
    directory.joinable(publicRoom.roomId(), false);
    assertThat(directory.publicRooms()).isEmpty();
    directory.joinable(publicRoom.roomId(), true);
    directory.describeRoom(publicRoom.roomId(), "PRIVATE", "RACE", 10);
    assertThat(directory.publicRooms()).isEmpty();
  }

  @Test
  void concurrentReservationsNeverExceedCapacityOrShareAColor() throws Exception {
    var directory = directory();
    var host = directory.createRoom();
    directory.describeRoom(host.roomId(), "PUBLIC", "RACE", 10);
    int capacity = directory.publicRooms().getFirst().capacity();
    var slots = new ArrayList<RoomDirectory.Slot>();
    slots.add(host);
    try (var pool = Executors.newFixedThreadPool(capacity)) {
      var attempts = new ArrayList<java.util.concurrent.Callable<RoomDirectory.Slot>>();
      for (int i = 0; i < capacity * 2; i++)
        attempts.add(
            () -> {
              try {
                return directory.room(host.roomId());
              } catch (ApiException full) {
                assertThat(full.code()).isEqualTo("ROOM_FULL");
                return null;
              }
            });
      for (var result : pool.invokeAll(attempts)) {
        var slot = result.get();
        if (slot != null) slots.add(slot);
      }
    }
    assertThat(slots).hasSize(capacity);
    assertThat(slots.stream().map(RoomDirectory.Slot::color).distinct()).hasSize(capacity);
    assertThat(directory.publicRooms()).isEmpty();
    directory.release(slots.removeLast());
    assertThat(directory.publicRooms().getFirst().playerCount()).isEqualTo(capacity - 1);
    slots.forEach(directory::release);
    assertThat(directory.find(host.roomId())).isNull();
  }
}
