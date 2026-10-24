package jumpking.support;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;

/** Client HTTP/WS thật, mỗi instance có cookies riêng. */
public final class GameClient implements AutoCloseable {
  @FunctionalInterface
  public interface Observer {
    void receive(JsonNode message, long nanos, int bytes);
  }

  public volatile Observer observer;
  private final ObjectMapper json = new ObjectMapper();
  private final Object sendLock = new Object();
  private final String origin;
  public final HttpClient http =
      HttpClient.newBuilder()
          .version(HttpClient.Version.HTTP_1_1)
          .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
          .connectTimeout(Duration.ofSeconds(3))
          .build();
  public final List<JsonNode> messages = new CopyOnWriteArrayList<>();
  public WebSocket socket;
  private volatile long connectionGeneration;
  private volatile Throwable socketFailure;
  private volatile Integer closeCode;
  private volatile String closeReason;
  public long owner;
  public boolean autoReady = true;
  private String csrf;

  public GameClient(int port) {
    origin = "http://127.0.0.1:" + port;
  }

  public JsonNode request(String path, String method, Object body) throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create(origin + "/api" + path)).timeout(Duration.ofSeconds(8));
    if (!method.equals("GET")) request.header("X-CSRF-TOKEN", csrf);
    if (body != null) request.header("Content-Type", "application/json");
    var response =
        http.send(
            request
                .method(
                    method,
                    body == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build(),
            HttpResponse.BodyHandlers.ofString());
    assertThat(response.statusCode()).as(path + " " + response.body()).isEqualTo(200);
    return json.readTree(response.body());
  }

  public void register() throws Exception {
    register("online_" + UUID.randomUUID().toString().replace("-", "").substring(0, 14));
  }

  public void register(String name) throws Exception {
    login(name, "A secure server integration password");
  }

  public void login(String username, String password) throws Exception {
    csrf = request("/auth/csrf", "GET", null).path("token").asText();
    owner =
        request("/auth/login", "POST", Map.of("username", username, "password", password))
            .path("account")
            .path("id")
            .asLong();
    csrf = request("/auth/csrf", "GET", null).path("token").asText();
  }

  public void connect() {
    long attempt = ++connectionGeneration;
    socketFailure = null;
    closeCode = null;
    closeReason = null;
    socket =
        http.newWebSocketBuilder()
            .header("Origin", "http://allowed.test")
            .connectTimeout(Duration.ofSeconds(3))
            .buildAsync(
                URI.create(origin.replace("http", "ws") + "/ws/game"),
                new WebSocket.Listener() {
                  final StringBuilder partial = new StringBuilder();

                  @Override
                  public void onOpen(WebSocket socket) {
                    socket.request(1);
                  }

                  @Override
                  public CompletionStage<?> onClose(WebSocket socket, int code, String reason) {
                    if (attempt == connectionGeneration) {
                      closeReason = reason;
                      closeCode = code;
                    }
                    return null;
                  }

                  @Override
                  public void onError(WebSocket socket, Throwable error) {
                    if (attempt == connectionGeneration) socketFailure = error;
                  }

                  @Override
                  public CompletionStage<?> onText(
                      WebSocket socket, CharSequence data, boolean last) {
                    partial.append(data);
                    if (last) {
                      try {
                        String text = partial.toString();
                        var message = json.readTree(text);
                        var sink = observer;
                        if (sink != null)
                          sink.receive(
                              message,
                              System.nanoTime(),
                              text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
                        messages.add(message);
                        if (autoReady && message.path("type").asText().equals("GAME_STARTED")) {
                          var payload = message.path("payload");
                          var ready =
                              json.createObjectNode()
                                  .put("v", 1)
                                  .put("type", "GAME_READY")
                                  .put("requestId", UUID.randomUUID().toString());
                          ready
                              .putObject("payload")
                              .put("playId", payload.path("playId").asText())
                              .put("generation", payload.path("generation").asLong());
                          synchronized (sendLock) {
                            socket.sendText(ready.toString(), true);
                          }
                        }
                      } catch (Exception error) {
                        throw new IllegalStateException(error);
                      }
                      partial.setLength(0);
                    }
                    socket.request(1);
                    return null;
                  }
                })
            .join();
  }

  public Map<String, Object> communityRequest() throws Exception {
    var current = request("/community/current", "GET", null).path("run");
    var payload = new HashMap<String, Object>();
    payload.put("newRun", current.isNull());
    payload.put("expectedRunId", current.isNull() ? null : current.path("id").asText());
    return payload;
  }

  public JsonNode command(String type, Map<String, ?> payload) throws Exception {
    String id = UUID.randomUUID().toString();
    send(
        json.writeValueAsString(Map.of("v", 1, "type", type, "requestId", id, "payload", payload)));
    return await(message -> id.equals(message.path("requestId").asText()));
  }

  public JsonNode ok(String type, Map<String, ?> payload) throws Exception {
    var result = command(type, payload);
    assertThat(result.path("type").asText()).as(result.toString()).isNotEqualTo("ERROR");
    if (autoReady && type.equals("START_GAME")) {
      String playId = result.path("payload").path("currentPlay").path("id").asText();
      await(
          message ->
              message.path("type").asText().equals("ROOM_STATE")
                  && message.path("payload").path("currentPlay").path("id").asText().equals(playId)
                  && message
                          .path("payload")
                          .path("currentPlay")
                          .path("countdownRemainingMs")
                          .asLong()
                      > 0);
    }
    return result.path("payload");
  }

  private void send(String text) {
    synchronized (sendLock) {
      socket.sendText(text, true).join();
    }
  }

  public void input(Map<String, ?> payload) throws Exception {
    send(json.writeValueAsString(Map.of("v", 1, "type", "PLAYER_INPUT", "payload", payload)));
  }

  public JsonNode await(Predicate<JsonNode> predicate) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
    do {
      var result = messages.stream().filter(predicate).reduce((first, second) -> second);
      if (result.isPresent()) return result.get();
      if (socketFailure != null)
        throw new AssertionError("WebSocket listener failed", socketFailure);
      if (closeCode != null)
        throw new AssertionError(
            "WebSocket closed before message: " + closeCode + " " + closeReason);
      Thread.sleep(10);
    } while (System.nanoTime() < deadline);
    throw new AssertionError(
        "Timed out waiting for game message; last messages: "
            + messages.stream().skip(Math.max(0, messages.size() - 5)).toList());
  }

  public JsonNode snapshot() {
    return messages.stream()
        .filter(message -> message.path("type").asText().equals("GAME_SNAPSHOT"))
        .reduce((first, second) -> second)
        .orElseThrow()
        .path("payload");
  }

  public static void until(BooleanSupplier condition) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
    while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(10);
    assertThat(condition.getAsBoolean()).as("Condition before deadline").isTrue();
  }

  public void disconnect() {
    var closing = socket;
    socket = null;
    if (closing == null || closing.isOutputClosed()) return;
    try {
      closing.sendClose(WebSocket.NORMAL_CLOSURE, "").join();
    } catch (java.util.concurrent.CompletionException error) {
      if (!closing.isOutputClosed()) throw error;
    }
  }

  @Override
  public void close() {
    disconnect();
    http.close();
  }
}
