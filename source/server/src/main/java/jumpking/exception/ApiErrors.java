package jumpking.exception;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrors {
  public static Map<String, Object> body(String code, String message) {
    return Map.of("error", Map.of("code", code, "message", message));
  }

  public static void write(
      HttpServletResponse response, ObjectMapper json, int status, String code, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    response.setHeader("Cache-Control", "no-store");
    json.writeValue(response.getOutputStream(), body(code, message));
  }

  @ExceptionHandler(ApiException.class)
  ResponseEntity<?> application(ApiException error) {
    return ResponseEntity.status(error.status()).body(body(error.code(), error.getMessage()));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class,
    org.springframework.web.bind.MethodArgumentNotValidException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> invalid() {
    return ResponseEntity.badRequest().body(body("VALIDATION", "Invalid request"));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  ResponseEntity<?> missing() {
    return ResponseEntity.status(404).body(body("NOT_FOUND", "Not found"));
  }

  @ExceptionHandler(DataAccessException.class)
  ResponseEntity<?> database() {
    return ResponseEntity.status(503)
        .body(body("UNAVAILABLE", "The service is temporarily unavailable"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected() {
    return ResponseEntity.internalServerError()
        .body(body("INTERNAL_ERROR", "The server could not complete this request"));
  }
}
