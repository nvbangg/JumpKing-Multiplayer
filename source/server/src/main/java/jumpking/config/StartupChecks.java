package jumpking.config;

import jumpking.repository.SchemaRepository;
import jumpking.service.RoomRuns;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Kiểm tra schema trước khi đóng các trận đã mất state RAM sau restart. */
@Component
public class StartupChecks implements ApplicationRunner {
  private final SchemaRepository schema;
  private final RoomRuns rooms;

  public StartupChecks(SchemaRepository schema, RoomRuns rooms) {
    this.schema = schema;
    this.rooms = rooms;
  }

  @Override
  public void run(ApplicationArguments args) {
    schema.validate();
    rooms.recoverAborted();
  }
}
