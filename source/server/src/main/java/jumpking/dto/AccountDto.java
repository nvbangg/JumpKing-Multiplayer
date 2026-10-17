package jumpking.dto;

public final class AccountDto {
  private AccountDto() {}

  public record Account(String id, String username, boolean crownUnlocked) {}

  public record Me(boolean authenticated, Account account) {}
}
