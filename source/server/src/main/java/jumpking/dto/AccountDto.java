package jumpking.dto;

public final class AccountDto {
  private AccountDto() {}

  public record Account(String id, String username, boolean crownUnlocked, boolean hasPassword) {}

  public record Me(boolean authenticated, Account account) {}
}
