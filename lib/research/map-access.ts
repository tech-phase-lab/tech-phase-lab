/** Who may open a relationship (連関) map. Owner decision (Oct 25): the NVDA map is a free sample, every other
 * company's map is PRO, and the owner account counts as PRO. (The Capital Map is a different feature and stays free.) */
export const FREE_SAMPLE_TICKER = "NVDA";

export type MapMember = { status: string; plan?: string; accessExpiresAt?: number; ownerAccount?: boolean };

export function mapAccess(member: MapMember | null, ticker: string, now = Date.now()): 200 | 401 | 403 | 503 {
  if (ticker === FREE_SAMPLE_TICKER) return 200;
  if (!member || member.status === "unavailable") return 503;
  if (member.status !== "signed-in") return 401;
  const pro = member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now;
  return pro || member.ownerAccount === true ? 200 : 403;
}
