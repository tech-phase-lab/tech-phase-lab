"use client";
import { SignIn, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";
export default function AccountScreen({ status, plan }: { status: string; plan: string }) {
  const [lang, setLang] = useResearchLanguage(); const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card}>
      {status === "unavailable" ? <><h2>{ja ? "ログインは準備中です" : "Sign-in is being prepared"}</h2><p>{ja ? "会員登録の受付開始まで、公開中のページをご利用いただけます。" : "You can explore the public pages while we prepare member registration."}</p><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : status === "signed-out" ? <SignIn routing="hash" fallbackRedirectUrl="/research/account" /> : <><span className={styles.plan}>TECH PHASE {plan === "pro" ? "PRO" : "FREE"}</span><h2>{ja ? "ログインしています" : "You’re signed in"}</h2><p>{plan === "pro" ? (ja ? "PRO会員として登録されています。" : "Your PRO membership is active.") : (ja ? "無料プランをご利用中です。" : "You’re on the Free plan.")}</p><Link href="/research/notifications">{ja ? "スマホ通知設定" : "Phone notifications"}</Link><SignOutButton redirectUrl="/research/account"><button>{ja ? "ログアウト" : "Sign out"}</button></SignOutButton></>}
    </section>
  </ResearchToolShell>;
}
