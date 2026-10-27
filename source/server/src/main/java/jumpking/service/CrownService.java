package jumpking.service;

import jumpking.entity.Crown;
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
  public Crown crown(long owner) {
    var user = users.findById(owner).orElseThrow();
    return user.getCrown();
  }

  // Caller đã khóa owner; crown và kết quả phải commit hoặc rollback cùng nhau.
  @Transactional(propagation = Propagation.MANDATORY)
  public void unlock(long owner, boolean ravenDone) {
    var user = users.findById(owner).orElseThrow();
    user.setCrown(user.getCrown().finish(ravenDone));
  }
}
