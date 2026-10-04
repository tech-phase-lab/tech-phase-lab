"use client";
import { SignIn, SignUp, SignOutButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import PreviewControls from "./preview-controls";
import styles from "./styles.module.css";
type Member = { status: string; plan: string; isAdmin: boolean; ownerMode: boolean; canTest: boolean; testing: boolean };
function AccountContent({ status, plan, signingUp = false, initialMember }: { status: string; plan: string; signingUp?: boolean; initialMember?: Member }) {
  const [lang, setLang] = useResearchLanguage(); const ja = lang === "ja";
  const { isLoaded, isSignedIn } = useAuth();
  const [member, setMember] = useState(initialMember ?? {status, plan, isAdmin: false, ownerMode: false, canTest: false, testing: false});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    fetch("/api/research/member", {cache:"no-store", signal:controller.signal})
      .then(async response => { if (!response.ok) throw new Error("membership"); return response.json(); })
      .then(value => setMember(value))
      .catch(error => { if (error.name !== "AbortError") setMember({status:"unavailable",plan:"",isAdmin:false,ownerMode:false,canTest:false,testing:false}); });
    return () => controller.abort();
  }, [isLoaded, isSignedIn, retry, initialMember]);
  const content = <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card}>
      {member.status === "unavailable" ? <><h2>{ja ? "会員情報を確認できませんでした" : "Sign-in is being prepared"}</h2><p>{ja ? "時間をおいて、もう一度お試しください。" : "You can explore the public pages while we prepare member registration."}</p><button onClick={() => setRetry(value => value + 1)}>{ja ? "再確認" : "Try again"}</button><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : !isLoaded && member.status !== "signed-in" ? <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "ログイン画面を準備しています" : "Loading sign-in"} /> : member.status === "signed-out" ? (signingUp ? <SignUp routing="hash" signInUrl="/research/account" forceRedirectUrl="/research/account" /> : <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl="/research/account" />) : <><span className={styles.plan}>TECH PHASE {member.ownerMode ? "運営者" : member.plan === "pro" ? "PRO" : "FREE"}</span><>{member.testing && <p>{ja ? "運営者用の試験状態です（課金なし）" : "Admin test mode — no charge"}</p>}</><h2>{member.ownerMode ? ja ? "運営者としてログインしています" : "Owner view" : ja ? "ログインしています" : "You’re signed in"}</h2><p>{member.plan === "pro" ? (ja ? "PRO会員として登録されています。" : "Your PRO membership is active.") : (ja ? "無料プランをご利用中です。" : "You’re on the Free plan.")}</p><Link href="/research/columns">{ja ? "PROリサーチ・コラム" : "PRO Research & Columns"}</Link><Link href="/research/notifications">{ja ? "スマホ通知設定" : "Phone notifications"}</Link>{member.isAdmin && <Link href="/research/write">{ja ? "ひとりごとを書く" : "Write a note"}</Link>}{member.isAdmin && <Link href="/api/research/member/export">{ja ? "登録者一覧をダウンロード" : "Download member list"}</Link>}<>{member.canTest && <PreviewControls ja={ja} testing={member.testing} onChange={() => setRetry(value => value + 1)} />}</><SignOutButton redirectUrl="/research/account"><button>{ja ? "ログアウト" : "Sign out"}</button></SignOutButton></>}
    </section>
  </ResearchToolShell>;
  return content;
}

export default function AccountScreen(props: {status:string; plan:string; signingUp?:boolean; initialMember?:Member}) {
  if (props.status === "unavailable") return <p>会員機能に接続できません。時間をおいて再度お試しください。</p>;
  return <AccountContent {...props} />;
}
