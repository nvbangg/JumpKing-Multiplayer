package jumpking.dto;

public record PlayerStanding(
    String playerId, String nickname, int colorSlot, int rank, double currentProgress) {}
