"use client";
import { ClerkProvider, SignIn, SignUp, SignOutButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { jaJP, enUS } from "@clerk/localizations";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import PreviewControls from "./preview-controls";
import styles from "./styles.module.css";
function AccountContent({ status, plan, signingUp = false }: { status: string; plan: string; signingUp?: boolean }) {
  const [lang, setLang] = useResearchLanguage(); const ja = lang === "ja";
  const { isLoaded, isSignedIn } = useAuth();
  const [member, setMember] = useState({status, plan, isAdmin: false, canTest: false, testing: false});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    fetch("/api/research/member", {cache:"no-store", signal:controller.signal})
      .then(async response => { if (!response.ok) throw new Error("membership"); return response.json(); })
      .then(value => setMember(value))
      .catch(error => { if (error.name !== "AbortError") setMember({status:"unavailable",plan:"",isAdmin:false,canTest:false,testing:false}); });
    return () => controller.abort();
  }, [isLoaded, isSignedIn, retry]);
  const content = <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card}>
      {member.status === "unavailable" ? <><h2>{ja ? "会員情報を確認できませんでした" : "Sign-in is being prepared"}</h2><p>{ja ? "時間をおいて、もう一度お試しください。" : "You can explore the public pages while we prepare member registration."}</p><button onClick={() => setRetry(value => value + 1)}>{ja ? "再確認" : "Try again"}</button><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : !isLoaded ? <p>{ja ? "読み込み中…" : "Loading…"}</p> : member.status === "signed-out" ? (signingUp ? <SignUp routing="hash" signInUrl="/research/account" forceRedirectUrl="/research/account" /> : <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl="/research/account" />) : <><span className={styles.plan}>TECH PHASE {member.plan === "pro" ? "PRO" : "FREE"}</span><>{member.testing && <p>{ja ? "運営者用の試験状態です（課金なし）" : "Admin test mode — no charge"}</p>}</><h2>{ja ? "ログインしています" : "You’re signed in"}</h2><p>{member.plan === "pro" ? (ja ? "PRO会員として登録されています。" : "Your PRO membership is active.") : (ja ? "無料プランをご利用中です。" : "You’re on the Free plan.")}</p><Link href="/research/columns">{ja ? "PROリサーチ・コラム" : "PRO Research & Columns"}</Link><Link href="/research/notifications">{ja ? "スマホ通知設定" : "Phone notifications"}</Link>{member.isAdmin && <Link href="/research/editorial">{ja ? "ひとりごと・記事を書く" : "Write notes & articles"}</Link>}{member.isAdmin && <Link href="/api/research/member/export">{ja ? "登録者一覧をダウンロード" : "Download member list"}</Link>}<>{member.canTest && <PreviewControls ja={ja} testing={member.testing} onChange={() => setRetry(value => value + 1)} />}</><SignOutButton redirectUrl="/research/account"><button>{ja ? "ログアウト" : "Sign out"}</button></SignOutButton></>}
    </section>
  </ResearchToolShell>;
  return content;
}

const japanese = {
  ...jaJP,
  formFieldInputPlaceholder__emailAddress: "例：name@example.com",
  socialButtonsBlockButton: "{{provider|titleize}}でログイン",
  signIn: {...jaJP.signIn, start: {...jaJP.signIn?.start,
    title: "Tech Phaseにログイン", titleCombined: "Tech Phaseにログイン",
    subtitle: "", subtitleCombined: "", actionText: "初めての方はこちら", actionLink: "無料で会員登録"}},
  signUp: {...jaJP.signUp, start: {...jaJP.signUp?.start,
    title: "Tech Phaseの無料会員登録", titleCombined: "Tech Phaseの無料会員登録",
    subtitle: "", subtitleCombined: "", actionText: "登録済みの方はこちら", actionLink: "ログイン"}},
};
export default function AccountScreen(props: {status:string; plan:string; signingUp?:boolean}) {
  const [lang] = useResearchLanguage();
  if (props.status === "unavailable") return <p>会員機能に接続できません。時間をおいて再度お試しください。</p>;
  return <ClerkProvider appearance={{
    variables: {colorPrimary:"#9bdec6", colorBackground:"#101e24", colorForeground:"#eaf3f1", colorMutedForeground:"#adc0c6", colorInput:"#0b151d", colorInputForeground:"#eaf3f1", borderRadius:"10px"},
    elements: {buttonArrowIcon:{display:"none"},footerAction:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"6px"},footerActionText:{margin:0,textAlign:"center"},socialButtonsBlockButton:{color:"#eaf3f1",background:"#1c303b",border:"1px solid #55717c"},socialButtonsBlockButtonText:{color:"#eaf3f1"},rootBox:{width:"100%"},cardBox:{width:"100%",boxShadow:"none"},card:{padding:"24px",boxShadow:"none"},headerTitle:{fontSize:"20px",lineHeight:"1.5"},formButtonPrimary:{color:"#0b151d"},footerActionLink:{display:"inline",margin:0,color:"#9bdec6"}}
  }} localization={lang === "ja" ? japanese : enUS} signInUrl="/research/account" signUpUrl="/research/account/sign-up"><AccountContent {...props} /></ClerkProvider>;
}
