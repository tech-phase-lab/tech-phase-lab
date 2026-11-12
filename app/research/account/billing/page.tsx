import { sandboxMemberAllowed } from "@/services/tech-phase-billing/access.mjs";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { OWNER_ACCOUNT_ID } from "@/lib/membership/entitlements";
import {liveEnabled} from "@/services/tech-phase-billing/live-http.mjs";
import BillingScreen from "./screen";

export const dynamic = "force-dynamic";
export default async function BillingPage({ searchParams }: { searchParams?: Promise<{ preview?: string }> } = {}) {
  const live=liveEnabled(process.env);
  const wantsPreview = (await searchParams)?.preview === "purchase";
  if (wantsPreview) {
    // The pre-purchase screen for a legal review: owner only, no payment call, button disabled.
    const { userId } = await auth();
    if (!userId) redirect("/research/account");
    if (userId !== OWNER_ACCOUNT_ID) notFound();
    return <BillingScreen mode="live" preview />;
  }
  if (!live && process.env.VERCEL_ENV !== "preview") notFound();
  const { userId } = await auth();
  if (!userId) redirect("/research/account");
  if (!live && !sandboxMemberAllowed(process.env, OWNER_ACCOUNT_ID, userId)) notFound();
  return <BillingScreen mode={live ? "live" : "sandbox"} />;
}
