import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMembership } from "@/lib/membership/server";
import { valueCheckAccess, valueCheckEnabled, type ValueSnapshot } from "@/lib/research/value-check";
import { loadValueSnapshot } from "@/lib/research/value-check-server";
import TreasureHuntScreen from "./screen";

export const metadata: Metadata = { title: "トレジャーハント | Tech Phase PRO", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** How long the page waits for the shared copy before it opens without it (the screen then asks the API, as before). */
const INITIAL_WAIT_MS = 1500;

/** Until the owner turns it on (NEXT_PUBLIC_VALUE_CHECK_ENABLED), only the owner's accounts can open the page.
 * Owner, Nov 26: the ranking must be there the moment the page opens. A member the server confirms (PRO, or the owner's accounts) gets
 * the day's ranking drawn into the page from the shared copy (lib/research/value-check-server.ts); nobody else is sent it. */
export default async function Page() {
  const member = await getMembership().catch(() => null);
  if (!valueCheckEnabled() && (!member || member.status !== "signed-in" || !("ownerAccount" in member) || !(member.ownerAccount || member.ownerMode))) notFound();
  let initial: ValueSnapshot | null = null;
  if (member && valueCheckAccess(member, valueCheckEnabled()) === 200) {
    const ready = loadValueSnapshot().catch(() => null);
    initial = await Promise.race([ready, new Promise<null>(resolve => setTimeout(() => resolve(null), INITIAL_WAIT_MS))]);
  }
  return <TreasureHuntScreen initial={initial} />;
}
