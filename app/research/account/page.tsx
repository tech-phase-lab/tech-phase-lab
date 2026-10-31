import { getMembership } from "@/lib/membership/server";
import {liveEnabled} from "@/services/tech-phase-billing/live-http.mjs";
import { readProfile } from "@/lib/account/server";
import AccountScreen from "./screen";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  let member;
  try { member = await getMembership(); } catch { member = {status:"unavailable",plan:"free"}; }
  // The top card is rendered into the first HTML (a short wait, then the screen loads it itself) so it never pops in.
  let initialProfile = null;
  if (member.status === "signed-in" && "userId" in member) {
    try { initialProfile = await Promise.race([readProfile(member.userId), new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))]); } catch { initialProfile = null; }
  }
  const screen = <AccountScreen initialProfile={initialProfile} billingAvailable={liveEnabled(process.env)} status={member.status} plan={member.plan} initialMember={{accessExpiresAt:"accessExpiresAt" in member ? member.accessExpiresAt : 0,status:member.status,plan:member.plan,isAdmin:"isAdmin" in member && member.isAdmin,ownerMode:"ownerMode" in member && member.ownerMode,canTest:"canTest" in member && member.canTest,testing:"testing" in member && member.testing}} />;
  return screen;
}
