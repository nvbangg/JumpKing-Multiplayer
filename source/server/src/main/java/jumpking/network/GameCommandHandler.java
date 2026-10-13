package jumpking.network;

public interface GameCommandHandler {
  boolean supports(GameConnection connection, GameEnvelope command);

  void handle(GameConnection connection, GameEnvelope command);

  void disconnected(GameConnection connection);
}
