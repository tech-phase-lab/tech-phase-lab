import { getMembership } from "@/lib/membership/server";
import {liveEnabled} from "@/services/tech-phase-billing/live-http.mjs";
import AccountScreen from "./screen";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  let member;
  try { member = await getMembership(); } catch { member = {status:"unavailable",plan:"free"}; }
  const screen = <AccountScreen billingAvailable={liveEnabled(process.env)} status={member.status} plan={member.plan} initialMember={{accessExpiresAt:"accessExpiresAt" in member ? member.accessExpiresAt : 0,status:member.status,plan:member.plan,isAdmin:"isAdmin" in member && member.isAdmin,ownerMode:"ownerMode" in member && member.ownerMode,canTest:"canTest" in member && member.canTest,testing:"testing" in member && member.testing}} />;
  return screen;
}
