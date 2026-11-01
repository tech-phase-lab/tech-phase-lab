import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { membershipConfigured } from "@/lib/membership/server";
import PortfolioScreen from "./screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "米国株の資産管理 | Tech Phase", robots: { index: false, follow: false } };
export default async function Page() {
  if (!membershipConfigured()) return <p>会員機能に接続できませんでした。</p>;
  if (!(await auth()).userId) redirect("/research/account");
  return <PortfolioScreen />;
}
