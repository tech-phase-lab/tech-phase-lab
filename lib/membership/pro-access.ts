import { isOwnerAccount } from "./entitlements.ts";

/** What a PRO-only page needs to know about the reader (from getMembership on the server). */
export type PageMember = { status: string; plan: string; accessExpiresAt?: number; userId?: string | null };

/**
 * PRO-only pages (owner, Nov 25: the 監視22銘柄 pages): a signed-in PRO member whose access has not expired, or either owner
 * account (OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID) in every environment, also while the owner tries the app as FREE
 * (AGENTS.md: operator access). Signed out, FREE, expired or an unreadable membership: no.
 */
export function proPageAllowed(member: PageMember, now = Date.now()): boolean {
  if (member.status !== "signed-in") return false;
  if (isOwnerAccount(member.userId)) return true;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now;
}
