package jumpking.support;

import static org.assertj.core.api.Assertions.*;

import java.net.ServerSocket;
import java.net.URI;
import java.net.http.*;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Khởi chạy Vite/Chrome thật cho một nhóm kiểm thử; chỉ dừng process do harness tạo. */
public final class BrowserHarness {
  private BrowserHarness() {}

  public static int freePort() {
    try (var socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    } catch (java.io.IOException error) {
      throw new IllegalStateException(error);
    }
  }

  public static void run(
      int backendPort, int vitePort, String name, String pattern, Map<String, String> environment)
      throws Exception {
    var frontend = Path.of("../client").toFile();
    var viteBuilder =
        new ProcessBuilder(
                "node",
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                Integer.toString(vitePort),
                "--strictPort")
            .directory(frontend);
    viteBuilder.environment().put("BACKEND_URL", "http://127.0.0.1:" + backendPort);
    var vite =
        viteBuilder
            .redirectErrorStream(true)
            .redirectOutput(Path.of("target/" + name + "-vite.log").toFile())
            .start();
    Process browser = null;
    try (var http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(1))
            .build()) {
      String origin = "http://127.0.0.1:" + vitePort;
      boolean ready = false;
      for (int attempt = 0; attempt < 80; attempt++) {
        assertThat(vite.isAlive()).as("Inspect target/" + name + "-vite.log").isTrue();
        try {
          if (http.send(
                      HttpRequest.newBuilder(URI.create(origin))
                          .timeout(Duration.ofSeconds(1))
                          .build(),
                      HttpResponse.BodyHandlers.discarding())
                  .statusCode()
              == 200) {
            ready = true;
            break;
          }
        } catch (java.io.IOException starting) {
        }
        Thread.sleep(250);
      }
      assertThat(ready).isTrue();
      var builder =
          new ProcessBuilder(
                  "node", "node_modules/@playwright/test/cli.js", "test", pattern, "--workers=1")
              .directory(frontend);
      builder.environment().put("E2E_BASE_URL", origin);
      builder.environment().put("E2E_OUTPUT_DIR", "../../.local/browser-" + name + "-tests");
      builder.environment().putAll(environment);
      browser =
          builder
              .redirectErrorStream(true)
              .redirectOutput(Path.of("target/" + name + "-browser.log").toFile())
              .start();
      assertThat(browser.waitFor(120, TimeUnit.SECONDS)).as("Browser timeout: " + name).isTrue();
      assertThat(browser.exitValue()).as("Inspect target/" + name + "-browser.log").isZero();
    } finally {
      if (browser != null && browser.isAlive()) {
        browser.destroyForcibly();
        browser.waitFor(5, TimeUnit.SECONDS);
      }
      vite.destroy();
      if (!vite.waitFor(10, TimeUnit.SECONDS)) {
        vite.destroyForcibly();
        vite.waitFor(5, TimeUnit.SECONDS);
      }
    }
  }
}
