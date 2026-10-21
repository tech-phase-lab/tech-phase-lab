import { sandboxMemberAllowed } from "@/services/tech-phase-billing/access.mjs";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { OWNER_ACCOUNT_ID } from "@/lib/membership/entitlements";
import BillingScreen from "./screen";

export const dynamic = "force-dynamic";
export default async function BillingPage() {
  if (process.env.VERCEL_ENV !== "preview") notFound();
  const { userId } = await auth();
  if (!userId) redirect("/research/account");
  if (!sandboxMemberAllowed(process.env, OWNER_ACCOUNT_ID, userId)) notFound();
  return <BillingScreen />;
}
