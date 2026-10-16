package jumpking.service;

import java.util.function.Function;
import java.util.function.Supplier;
import jumpking.exception.ApiException;
import jumpking.repository.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class RunOwners {
  private final UserRepository users;
  private final TransactionTemplate transactions;

  public RunOwners(UserRepository users, TransactionTemplate transactions) {
    this.users = users;
    this.transactions = transactions;
  }

  public <T> T write(long id, Function<Long, T> writer) {
    return writeAll(java.util.List.of(id), () -> writer.apply(id));
  }

  public <T> T writeAll(java.util.Collection<Long> sources, Supplier<T> writer) {
    return transactions.execute(
        status -> {
          // Thứ tự khóa cố định tránh deadlock khi ghi kết quả nhiều người.
          for (long id : new java.util.TreeSet<>(sources)) {
            users
                .lockById(id)
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "Account not found"));
          }
          return writer.get();
        });
  }
}
