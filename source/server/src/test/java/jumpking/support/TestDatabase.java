package jumpking.support;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.containers.MySQLContainer;

public final class TestDatabase {
  private static TestDatabase instance;
  private final MySQLContainer<?> container;
  public final DriverManagerDataSource dataSource;
  public final JdbcTemplate jdbc;

  private TestDatabase() throws Exception {
    String url = System.getenv("JK_TEST_DATABASE_URL");
    if (url == null) container = new MySQLContainer<>("mysql:8.4");
    else container = null;
    try {
      if (container != null) {
        container.withDatabaseName("jumpking_it");
        container.start();
        dataSource =
            new DriverManagerDataSource(
                container.getJdbcUrl(), container.getUsername(), container.getPassword());
      } else {
        dataSource =
            new DriverManagerDataSource(
                url,
                System.getenv("JK_TEST_DATABASE_USERNAME"),
                System.getenv("JK_TEST_DATABASE_PASSWORD"));
      }
      jdbc = new JdbcTemplate(dataSource);
      String name = jdbc.queryForObject("SELECT DATABASE()", String.class);
      if (name == null
          || !name.startsWith("jumpking_it")
          || jdbc.queryForObject(
                  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()",
                  Integer.class)
              != 0) {
        throw new IllegalStateException("Integration requires a new, empty jumpking_it database");
      }
      // Chỉ tạo bảng trong database test đã kiểm tra; không chạy phần reset jumpking.
      String ddl = tableDdl(Files.readString(Path.of("../database/schema.sql")));
      try (var connection = dataSource.getConnection()) {
        ScriptUtils.executeSqlScript(
            connection, new ByteArrayResource(ddl.getBytes(StandardCharsets.UTF_8)));
      }
      // Container dùng chung suốt JVM test; không đóng sau mỗi test hoặc constructor.
      if (container != null)
        Runtime.getRuntime().addShutdownHook(new Thread(this::close, "test-mysql-cleanup"));
    } catch (Exception | Error failure) {
      try {
        close();
      } catch (RuntimeException cleanupFailure) {
        failure.addSuppressed(cleanupFailure);
      }
      throw failure;
    }
  }

  public long account() {
    String name =
        "fixture_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    jdbc.update(
        "INSERT INTO users(username,password_hash,crown,created_at) VALUES (?,'unused-test-hash','NONE',UTC_TIMESTAMP(3))",
        name);
    return jdbc.queryForObject("SELECT id FROM users WHERE username=?", Long.class, name);
  }

  private void close() {
    if (container != null) container.close();
  }

  static String tableDdl(String schema) {
    int start = schema.indexOf("CREATE TABLE ");
    if (start < 0) throw new IllegalArgumentException("Schema has no table definitions");
    String ddl = schema.substring(start);
    if (java.util.regex.Pattern.compile(
            "(?i)\\b(?:CREATE|DROP|ALTER)\\s+(?:DATABASE|SCHEMA)\\b|\\bUSE\\s+")
        .matcher(ddl)
        .find()) {
      throw new IllegalArgumentException("Test DDL must not change databases");
    }
    return ddl;
  }

  public static synchronized TestDatabase get() {
    if (instance == null)
      try {
        instance = new TestDatabase();
      } catch (Exception error) {
        throw new IllegalStateException(
            "Could not initialize isolated integration database", error);
      }
    return instance;
  }
}
