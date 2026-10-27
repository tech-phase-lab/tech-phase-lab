import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { membershipConfigured } from "@/lib/membership/server";
import SecurityScreen from "./screen";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!membershipConfigured()) return <p>会員機能に接続できませんでした。</p>;
  if (!(await auth()).userId) redirect("/research/account");
  return <SecurityScreen />;
}
