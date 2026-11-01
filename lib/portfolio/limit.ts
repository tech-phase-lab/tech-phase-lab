import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { isOwnerAccount } from "../membership/entitlements.ts";

/** Reading a screenshot costs money: a signed-in reader gets a small number per day; the owner is not limited. */
export const DAILY_READS = 10;
type Usage = { day?: string; count?: number };

export async function takeRead(userId: string, now = new Date()): Promise<{ ok: boolean; left: number }> {
  if (isOwnerAccount(userId)) return { ok: true, left: DAILY_READS };
  const today = now.toISOString().slice(0, 10);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const usage = (user.privateMetadata.portfolioReads ?? {}) as Usage;
  const used = usage.day === today ? usage.count ?? 0 : 0;
  if (used >= DAILY_READS) return { ok: false, left: 0 };
  await client.users.updateUserMetadata(userId, { privateMetadata: { portfolioReads: { day: today, count: used + 1 } } });
  return { ok: true, left: DAILY_READS - used - 1 };
}
