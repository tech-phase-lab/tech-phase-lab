import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMembership } from "@/lib/membership/server";
import { valueCheckEnabled } from "@/lib/research/value-check";
import ValueCheckScreen from "./screen";

export const metadata: Metadata = { title: "割安判別ツール | Tech Phase PRO", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Until the owner turns it on (NEXT_PUBLIC_VALUE_CHECK_ENABLED), only the owner's accounts can open the page. */
export default async function Page() {
  if (!valueCheckEnabled()) {
    const member = await getMembership().catch(() => null);
    if (!member || member.status !== "signed-in" || !("ownerAccount" in member) || !(member.ownerAccount || member.ownerMode)) notFound();
  }
  return <ValueCheckScreen />;
}
