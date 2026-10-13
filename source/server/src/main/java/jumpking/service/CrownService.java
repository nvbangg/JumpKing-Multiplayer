package jumpking.service;

import jumpking.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CrownService {
  private final UserRepository users;

  public CrownService(UserRepository users) {
    this.users = users;
  }

  @Transactional(readOnly = true)
  public boolean unlocked(long owner) {
    var user = users.findById(owner).orElseThrow();
    return user.isCrownUnlocked();
  }

  // Caller đã khóa owner; crown và kết quả phải commit hoặc rollback cùng nhau.
  @Transactional(propagation = Propagation.MANDATORY)
  public void unlock(long owner) {
    users.findById(owner).orElseThrow().setCrownUnlocked(true);
  }
}
