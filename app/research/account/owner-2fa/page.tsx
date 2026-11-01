import { redirect } from "next/navigation";
import { signedInOwner } from "@/lib/owner-2fa/server";
import { membershipConfigured } from "@/lib/membership/server";
import OwnerTwoFactorScreen from "./screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "運営者の2段階認証", robots: { index: false, follow: false } };
export default async function Page() {
  if (!membershipConfigured()) return <p>会員機能に接続できませんでした。</p>;
  if (!(await signedInOwner())) redirect("/research/account");
  return <OwnerTwoFactorScreen />;
}
