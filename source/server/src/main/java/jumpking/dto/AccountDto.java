package jumpking.dto;

import jumpking.entity.Crown;

public final class AccountDto {
  private AccountDto() {}

  public record Account(String id, String username, Crown crown, boolean hasPassword) {}

  public record Me(boolean authenticated, Account account) {}
}
