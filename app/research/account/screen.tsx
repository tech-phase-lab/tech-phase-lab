"use client";
import { AuthenticateWithRedirectCallback, SignIn, SignUp, SignOutButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "../identity-provider";
import PreviewControls from "./preview-controls";
import styles from "./styles.module.css";
type Member = { accessExpiresAt?: number; status: string; plan: string; isAdmin: boolean; ownerMode: boolean; canTest: boolean; testing: boolean };
function AccountContent({ status, plan, signingUp = false, initialMember }: { status: string; plan: string; signingUp?: boolean; initialMember?: Member }) {
  const [lang, setLang] = useResearchLanguage(); const ja = lang === "ja";
  const { isLoaded, isSignedIn } = useAuth();
  const [member, setMember] = useState(initialMember ?? {status, plan, isAdmin: false, ownerMode: false, canTest: false, testing: false});
  const refreshIdentity = useIdentityRefresh();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    recoverMember(refreshIdentity, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), true)
      .then(({ response, member }) => { if (!response.ok) throw new Error("membership"); return member; })
      .then(value => { if (!controller.signal.aborted) setMember(value); })
      .catch(error => { if (!controller.signal.aborted && error.name !== "AbortError") setMember({status:"unavailable",plan:"",isAdmin:false,ownerMode:false,canTest:false,testing:false}); });
    return () => controller.abort();
  }, [isLoaded, isSignedIn, retry, initialMember, refreshIdentity]);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let lastResume = 0;
    const refresh = () => setRetry(value => value + 1);
    const resume = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastResume < 1000) return;
      lastResume = Date.now(); refresh();
    };
    // Re-read the server at expiry instead of retaining an old PRO account card.
    const expiry = member.plan === "pro" && !member.ownerMode && Number.isFinite(member.accessExpiresAt)
      ? setTimeout(refresh, Math.max(1000, Math.min(member.accessExpiresAt! - Date.now(), 2_147_483_647)))
      : undefined;
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("tech-phase:membership-changed", refresh);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(expiry);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("tech-phase:membership-changed", refresh);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [isLoaded, isSignedIn, member.plan, member.ownerMode, member.accessExpiresAt]);
  const content = <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card}>
      {member.status === "unavailable" ? <><h2>{ja ? "会員情報を確認できませんでした" : "Could not verify your membership"}</h2><p>{ja ? "時間をおいて、もう一度お試しください。" : "Please wait a moment and try again."}</p><button onClick={() => setRetry(value => value + 1)}>{ja ? "再確認" : "Try again"}</button><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : !isLoaded && member.status !== "signed-in" ? <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "ログイン画面を準備しています" : "Loading sign-in"} /> : member.status === "signed-out" ? (signingUp ? <SignUp routing="hash" signInUrl="/research/account" forceRedirectUrl="/research/account" /> : <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl="/research/account" />) : <><span className={styles.plan}>TECH PHASE {member.ownerMode ? (ja ? "運営者" : "Owner") : member.plan === "pro" ? "PRO" : "FREE"}</span><>{member.testing && <p>{ja ? "運営者用の試験状態です（課金なし）" : "Admin test mode — no charge"}</p>}</><h2>{member.ownerMode ? ja ? "運営者としてログインしています" : "Owner view" : ja ? "ログインしています" : "You’re signed in"}</h2><p>{member.plan === "pro" ? (ja ? "PRO会員として登録されています。" : "Your PRO membership is active.") : (ja ? "無料プランをご利用中です。" : "You’re on the Free plan.")}</p><Link href="/research/columns">{ja ? "PROリサーチ・コラム" : "PRO Research & Columns"}</Link><Link href="/research/notifications">{ja ? "スマホ通知設定" : "Phone notifications"}</Link>{member.isAdmin && <Link href="/research/write">{ja ? "ひとりごとを書く" : "Write a note"}</Link>}{member.status === "signed-in" && member.isAdmin === true && <Link href="/research/review" prefetch={false}>{ja ? "ニュース配信状況" : "News delivery status"}</Link>}{member.isAdmin && <Link href="/api/research/member/export">{ja ? "登録者一覧をダウンロード" : "Download member list"}</Link>}<>{member.canTest && <PreviewControls ja={ja} testing={member.testing} onChange={() => setRetry(value => value + 1)} />}</><SignOutButton redirectUrl="/research/account"><button>{ja ? "ログアウト" : "Sign out"}</button></SignOutButton></>}
    </section>
  </ResearchToolShell>;
  return content;
}

function subscribeCallbackRoute(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
  };
}
function isCallbackRoute() {
  // Match only the route, never parse, log, or rewrite OAuth credentials.
  return /^#\/sso-callback(?:[?#]|$)/.test(window.location.hash);
}
function AccountCallback() {
  const [lang] = useResearchLanguage();
  return <>
    <p role="status">{lang === "ja" ? "ログインを完了しています…" : "Completing sign-in…"}</p>
    <AuthenticateWithRedirectCallback
      signInUrl="/research/account"
      signUpUrl="/research/account/sign-up"
      signInForceRedirectUrl="/research/account"
      signUpForceRedirectUrl="/research/account"
    />
  </>;
}

export default function AccountScreen(props: {status:string; plan:string; signingUp?:boolean; initialMember?:Member}) {
  const callback = useSyncExternalStore(subscribeCallbackRoute, isCallbackRoute, () => false);
  // Handle the OAuth return independently of the SignIn widget's hash router.
  // In particular, a nested return fragment must not leave an empty Clerk card.
  if (callback) return <AccountCallback />;
  if (props.status === "unavailable") return <p>会員機能に接続できません。時間をおいて再度お試しください。</p>;
  return <AccountContent {...props} />;
}
