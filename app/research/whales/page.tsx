import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMembership } from "@/lib/membership/server";
import { whaleMovesEnabled } from "@/lib/research/whale-moves";
import WhaleMovesScreen from "./screen";

export const metadata: Metadata = { title: "クジラの足あと | Tech Phase PRO", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Until the owner turns it on (NEXT_PUBLIC_WHALE_MOVES_ENABLED), only the owner's accounts can open the page. */
export default async function Page() {
  if (!whaleMovesEnabled()) {
    const member = await getMembership().catch(() => null);
    if (!member || member.status !== "signed-in" || !("ownerAccount" in member) || !(member.ownerAccount || member.ownerMode)) notFound();
  }
  return <WhaleMovesScreen />;
}
