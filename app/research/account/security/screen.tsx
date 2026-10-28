"use client";
import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import { useResearchLanguage } from "../../use-research-language";
export default function SecurityScreen() {
  const [lang] = useResearchLanguage();
  return <main style={{ padding: "20px 12px", maxWidth: 900, margin: "auto" }}>
    <Link href="/research/account">{lang === "ja" ? "マイアカウントに戻る" : "Back to my account"}</Link>
    <h1>{lang === "ja" ? "アカウントのセキュリティ" : "Account security"}</h1>
    <UserProfile routing="hash" />
  </main>;
}
