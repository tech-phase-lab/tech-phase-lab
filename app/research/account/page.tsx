import { getMembership } from "@/lib/membership/server";
import AccountScreen from "./screen";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  let member;
  try { member = await getMembership(); } catch { member = {status:"unavailable",plan:"free"}; }
  const screen = <AccountScreen status={member.status} plan={member.plan} initialMember={{status:member.status,plan:member.plan,isAdmin:"isAdmin" in member && member.isAdmin,ownerMode:"ownerMode" in member && member.ownerMode,canTest:"canTest" in member && member.canTest,testing:"testing" in member && member.testing}} />;
  return screen;
}
