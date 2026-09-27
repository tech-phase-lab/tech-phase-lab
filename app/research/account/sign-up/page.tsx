import { getMembership } from "@/lib/membership/server";
import AccountScreen from "../screen";
export const dynamic = "force-dynamic";
export default async function SignUpPage() {
  let member: {status: string; plan: string};
  try { member = await getMembership(); } catch { member = {status:"unavailable",plan:"free"}; }
  const screen = <AccountScreen status={member.status} plan={member.plan} signingUp />;
  return screen;
}
