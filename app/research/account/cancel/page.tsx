import { getMembership } from "@/lib/membership/server";
import { liveEnabled } from "@/services/tech-phase-billing/live-http.mjs";
import { redirect } from "next/navigation";
import CancelScreen from "./screen";

export const dynamic = "force-dynamic";
/** 解約の手続き (owner, Nov 5). Signed-in members only; the contract itself is read and changed through the existing billing calls. */
export default async function CancelPage() {
  let member;
  try { member = await getMembership(); } catch { member = { status: "unavailable" as const }; }
  // Signed out: the account page asks for sign-in. A temporary membership error still opens the page, which checks the contract itself.
  if (member.status !== "signed-in" && member.status !== "unavailable") redirect("/research/account");
  return <CancelScreen mode={liveEnabled(process.env) ? "live" : "sandbox"} />;
}
