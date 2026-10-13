package jumpking.room;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import jumpking.exception.ApiException;
import org.springframework.stereotype.Component;

@Component
public class Memberships {
  public record Membership(String roomId, String playerId) {}

  private final Map<Long, Membership> members = new HashMap<>();
  private final Set<Long> changing = new HashSet<>();

  public synchronized Membership find(long owner) {
    return members.get(owner);
  }

  public synchronized void claim(long owner, Membership membership) {
    if (changing.contains(owner)) throw busy();
    var existing = members.putIfAbsent(owner, membership);
    if (existing != null && !existing.equals(membership))
      throw new ApiException(409, "CONFLICT", "Leave your current room first");
  }

  public synchronized void release(long owner, Membership expected) {
    members.remove(owner, expected);
  }

  public <T> T changingIdentity(Long current, Long target, Supplier<T> action) {
    var owners = new HashSet<Long>();
    if (current != null) owners.add(current);
    if (target != null) owners.add(target);
    return change(
        owners, current != null && !current.equals(target) ? Set.of(current) : Set.of(), action);
  }

  private <T> T change(Set<Long> owners, Set<Long> vacant, Supplier<T> action) {
    synchronized (this) {
      if (owners.stream().anyMatch(changing::contains)) throw busy();
      if (vacant.stream().anyMatch(members::containsKey))
        throw new ApiException(409, "CONFLICT", "Leave your current room before changing identity");
      changing.addAll(owners);
    }
    // Transaction chạy ngoài registry lock; Join đang đổi identity bị từ chối thay vì chặn tick.
    try {
      return action.get();
    } finally {
      synchronized (this) {
        changing.removeAll(owners);
      }
    }
  }

  private static ApiException busy() {
    return new ApiException(409, "CONFLICT", "Identity is changing; try again shortly");
  }
}
