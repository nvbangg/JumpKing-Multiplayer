package jumpking.support;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class TestDatabaseTest {
  @Test
  void actualSchemaKeepsDatabaseResetOutOfIntegrationSetup() throws Exception {
    String schema = Files.readString(Path.of("../database/schema.sql"));
    assertThat(schema).contains("DROP DATABASE IF EXISTS jumpking;");
    String ddl = TestDatabase.tableDdl(schema);
    assertThat(ddl)
        .startsWith("CREATE TABLE users")
        .doesNotContain("DROP DATABASE", "CREATE DATABASE", "USE jumpking");
    assertThat(java.util.Arrays.stream(ddl.split(";")).filter(statement -> !statement.isBlank()))
        .hasSize(3);
  }

  @Test
  void refusesDatabaseCommandsAfterTableDefinitions() {
    for (String command :
        new String[] {
          "DROP DATABASE jumpking", "use jumpking", "CREATE SCHEMA other", "ALTER DATABASE jumpking"
        }) {
      assertThatIllegalArgumentException()
          .isThrownBy(
              () -> TestDatabase.tableDdl("CREATE TABLE fixture(id INT); " + command + ";"));
    }
    assertThatIllegalArgumentException()
        .isThrownBy(() -> TestDatabase.tableDdl("DROP DATABASE jumpking;"));
  }
}
