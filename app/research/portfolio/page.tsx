import { redirect } from "next/navigation";
import { getMembership, membershipConfigured } from "@/lib/membership/server";
import PortfolioScreen from "./screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "米国株の資産管理 | Tech Phase", robots: { index: false, follow: false } };
export default async function Page() {
  if (!membershipConfigured()) return <p>会員機能に接続できませんでした。</p>;
  const member = await getMembership();
  if (member.status !== "signed-in") redirect("/research/account");
  // PRO members only (the owner counts as PRO; the owner's FREE view behaves like FREE).
  if (member.plan !== "pro") redirect("/research");
  return <PortfolioScreen />;
}
