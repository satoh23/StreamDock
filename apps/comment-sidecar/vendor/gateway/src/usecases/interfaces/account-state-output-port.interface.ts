import type { AccountLinkSnapshot } from "@comment-dock/shared";

export type AccountStateOutputEvent = AccountLinkSnapshot;

export interface AccountStateOutputPort {
  publishAccountState(event: AccountStateOutputEvent): Promise<void>;
}
