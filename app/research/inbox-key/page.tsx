import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMembership } from "@/lib/membership/server";
import InboxKeyScreen from "./screen";
export const metadata: Metadata = { title: "受信箱の鍵 | Tech Phase Research", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
/** Owner only: the key the phone shortcut uses to send voice memos to the inbox. */
export default async function Page() {
  const member = await getMembership();
  if (member.status !== "signed-in" || !member.isAdmin) redirect("/research/notes");
  return <InboxKeyScreen />;
}
