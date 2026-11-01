"use client";
import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";

/** Members and the owner open this same page: Clerk's own profile (password, two-step verification, devices) inside the site's frame. */
export default function SecurityScreen() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "セキュリティ" : "Security"}
    description={ja ? "パスワードと2段階認証を管理します。" : "Manage your password and two-step verification."}>
    <Link href="/research/account" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "0 0 14px", padding: "8px 14px", borderRadius: 999, border: "1px solid #2c4450", color: "#9bdec6", fontSize: 14, textDecoration: "none" }}>
      <span aria-hidden="true">‹</span>{ja ? "アカウントに戻る" : "Back to account"}
    </Link>
    <UserProfile routing="hash" />
  </ResearchToolShell>;
}
