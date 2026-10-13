package jumpking.room;

import org.springframework.stereotype.Component;

/** Clock gameplay/deadlines không phụ thuộc việc chỉnh đồng hồ hệ điều hành. */
@Component
public class MonotonicTime {
  public long nanos() {
    return System.nanoTime();
  }
}
