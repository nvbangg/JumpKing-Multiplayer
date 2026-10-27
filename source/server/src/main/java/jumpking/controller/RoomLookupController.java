package jumpking.controller;

import jumpking.exception.ApiException;
import jumpking.room.RoomDirectory;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomLookupController {
  private final RoomDirectory directory;
  private final jumpking.network.GameTransport transport;

  public RoomLookupController(RoomDirectory directory, jumpking.network.GameTransport transport) {
    this.directory = directory;
    this.transport = transport;
  }

  @GetMapping
  public java.util.Map<String, ?> list(jakarta.servlet.http.HttpServletRequest request) {
    transport.publicLookup(request.getRemoteAddr());
    return java.util.Map.of("rooms", directory.publicRooms());
  }

  @GetMapping("/{id}")
  RoomDirectory.Info lookup(
      @PathVariable String id, jakarta.servlet.http.HttpServletRequest request) {
    transport.publicLookup(request.getRemoteAddr());
    if (!id.matches("[0-9]{6}")) throw new ApiException(400, "VALIDATION", "Invalid room ID");
    var info = directory.find(id);
    if (info == null || !info.kind().equals("ROOM"))
      throw new ApiException(404, "ROOM_NOT_FOUND", "Room not found");
    return info;
  }
}
