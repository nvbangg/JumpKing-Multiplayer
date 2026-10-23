package jumpking.room;

import java.security.SecureRandom;
import java.util.BitSet;
import java.util.HashMap;
import java.util.Map;
import jumpking.config.NetworkSettings;
import jumpking.exception.ApiException;
import jumpking.game.SharedData;
import org.springframework.stereotype.Component;

/**
 * Registry ngắn hạn: giữ chỗ trước khi enqueue/đợi persistence, dùng chung quotas hai kiểu chơi.
 */
@Component
public class RoomDirectory {
  public record Info(String roomId, String kind, boolean joinable) {}

  public record Slot(String roomId, String kind, int color) {}

  public record PublicRoom(
      String roomId, String mode, int mapLevel, int playerCount, int capacity) {}

  private static class Entry {
    final String kind;
    final BitSet slots = new BitSet();
    boolean joinable = true;
    String visibility = "PRIVATE", mode = "RACE";
    int mapLevel = 1;

    Entry(String kind) {
      this.kind = kind;
    }
  }

  private final Map<String, Entry> entries = new HashMap<>();
  private final SecureRandom random = new SecureRandom();
  private final String alphabet;
  private final int capacity, length, maximum;

  public RoomDirectory(SharedData shared, NetworkSettings limits) {
    var rules = shared.rules();
    alphabet = rules.path("roomCodeAlphabet").asText();
    length = rules.path("roomCodeLength").asInt();
    capacity = rules.path("capacity").asInt();
    maximum = limits.rooms();
  }

  public synchronized Info find(String id) {
    var entry = entries.get(id);
    return entry == null
        ? null
        : new Info(id, entry.kind, entry.joinable && entry.slots.cardinality() < capacity);
  }

  public synchronized java.util.List<PublicRoom> publicRooms() {
    return entries.entrySet().stream()
        .filter(
            value -> {
              var entry = value.getValue();
              return entry.kind.equals("ROOM")
                  && entry.visibility.equals("PUBLIC")
                  && entry.joinable
                  && entry.slots.cardinality() < capacity;
            })
        .sorted(Map.Entry.comparingByKey())
        .map(
            value ->
                new PublicRoom(
                    value.getKey(),
                    value.getValue().mode,
                    value.getValue().mapLevel,
                    value.getValue().slots.cardinality(),
                    capacity))
        .toList();
  }

  public synchronized void describeRoom(String id, String visibility, String mode, int mapLevel) {
    var entry = entries.get(id);
    if (entry != null && entry.kind.equals("ROOM")) {
      entry.visibility = visibility;
      entry.mode = mode;
      entry.mapLevel = mapLevel;
    }
  }

  public synchronized Slot community() {
    String id =
        entries.entrySet().stream()
            .filter(
                entry ->
                    entry.getValue().kind.equals("COMMUNITY")
                        && entry.getValue().slots.cardinality() < capacity)
            .max(java.util.Comparator.comparingInt(entry -> entry.getValue().slots.cardinality()))
            .map(Map.Entry::getKey)
            .orElse(null);
    if (id == null) id = create("COMMUNITY");
    return reserve(id, "COMMUNITY");
  }

  public synchronized Slot createRoom() {
    return reserve(create("ROOM"), "ROOM");
  }

  public synchronized Slot room(String id) {
    return reserve(id, "ROOM");
  }

  private String create(String kind) {
    if (entries.size() >= maximum)
      throw new ApiException(429, "RATE_LIMITED", "Server room limit reached");
    String id;
    do {
      var code = new StringBuilder();
      for (int i = 0; i < length; i++)
        code.append(alphabet.charAt(random.nextInt(alphabet.length())));
      id = code.toString();
    } while (entries.containsKey(id));
    entries.put(id, new Entry(kind));
    return id;
  }

  private Slot reserve(String id, String kind) {
    Entry entry = entries.get(id);
    if (entry == null || !entry.kind.equals(kind))
      throw new ApiException(404, "ROOM_NOT_FOUND", "Room not found");
    if (!entry.joinable)
      throw new ApiException(409, "ROOM_NOT_JOINABLE", "This room is not accepting new players");
    int color = entry.slots.nextClearBit(0);
    if (color >= capacity) throw new ApiException(409, "ROOM_FULL", "This room is full");
    entry.slots.set(color);
    return new Slot(id, kind, color);
  }

  public synchronized void joinable(String id, boolean value) {
    var entry = entries.get(id);
    if (entry != null) entry.joinable = value;
  }

  public synchronized boolean release(Slot slot) {
    return release(slot, false);
  }

  public synchronized boolean release(Slot slot, boolean retainEmpty) {
    var entry = entries.get(slot.roomId());
    if (entry == null) return true;
    entry.slots.clear(slot.color());
    if (!entry.slots.isEmpty()) return false;
    if (!retainEmpty) entries.remove(slot.roomId());
    return true;
  }

  public synchronized void releaseEmptyRoom(String id) {
    var entry = entries.get(id);
    if (entry != null && entry.kind.equals("ROOM") && entry.slots.isEmpty()) entries.remove(id);
  }
}
