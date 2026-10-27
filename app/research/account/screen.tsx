"use client";
import { AuthenticateWithRedirectCallback, SignIn, SignUp, SignOutButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "../identity-provider";
import { readAccountReturn } from "@/lib/research/account-return";
import PreviewControls from "./preview-controls";
import styles from "./styles.module.css";
const subscribeReturn = () => () => {};
function returnSnapshot() {
  try { return readAccountReturn(window.sessionStorage); } catch { return "/research/account"; }
}
function useAccountReturn() { return useSyncExternalStore<string | null>(subscribeReturn, returnSnapshot, () => null); }
function AccountUnavailable() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card} role="alert">
      <h2>{ja ? "会員機能に接続できませんでした" : "Could not connect to account services"}</h2>
      <p>{ja ? "時間をおいて、もう一度お試しください。" : "Please wait a moment and try again."}</p>
      <button type="button" onClick={() => window.location.reload()}>{ja ? "再読み込み" : "Reload"}</button>
      <Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link>
    </section>
  </ResearchToolShell>;
}
type Member = { adminMfaRequired?: boolean; accessExpiresAt?: number; status: string; plan: string; isAdmin: boolean; ownerMode: boolean; canTest: boolean; testing: boolean };
function AccountContent({ status, plan, signingUp = false, initialMember, billingAvailable = false }: { status: string; plan: string; signingUp?: boolean; initialMember?: Member; billingAvailable?: boolean }) {
  const [lang, setLang] = useResearchLanguage(); const ja = lang === "ja";
  const { isLoaded, isSignedIn } = useAuth();
  const returnTo = useAccountReturn();
  const [verifiedMember, setMember] = useState(initialMember ?? {status, plan, isAdmin: false, ownerMode: false, canTest: false, testing: false});
  // Server hints may be signed-out while Clerk JS is still starting. Do not renew
  // a nonexistent session or replace the sign-in form with a membership error.
  const member: Member = isLoaded && isSignedIn === false
    ? {status:"signed-out",plan:"free",isAdmin:false,ownerMode:false,canTest:false,testing:false}
    : verifiedMember;
  const refreshIdentity = useIdentityRefresh();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const controller = new AbortController();
    recoverMember(refreshIdentity, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), true)
      .then(({ response, member }) => { if (!response.ok || (isSignedIn && member.status === "signed-out")) throw new Error("membership"); return member; })
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
      {member.status === "unavailable" ? <><h2>{ja ? "会員情報を確認できませんでした" : "Could not verify your membership"}</h2><p>{ja ? "時間をおいて、もう一度お試しください。" : "Please wait a moment and try again."}</p><button onClick={() => setRetry(value => value + 1)}>{ja ? "再確認" : "Try again"}</button><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : (!isLoaded || returnTo === null || (isSignedIn && member.status === "signed-out")) && member.status !== "signed-in" ? <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "ログイン画面を準備しています" : "Loading sign-in"} /> : member.status === "signed-out" ? (signingUp ? <SignUp routing="hash" signInUrl="/research/account" forceRedirectUrl={returnTo ?? "/research/account"} /> : <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl={returnTo ?? "/research/account"} />) : <><span className={styles.plan}>TECH PHASE {member.ownerMode ? (ja ? "運営者" : "Owner") : member.plan === "pro" ? "PRO" : "FREE"}</span><>{member.testing && <p>{ja ? "運営者用の試験状態です（課金なし）" : "Admin test mode — no charge"}</p>}</><h2>{member.ownerMode ? ja ? "運営者としてログインしています" : "Owner view" : ja ? "ログインしています" : "You’re signed in"}</h2><p>{member.plan === "pro" ? (ja ? "PRO会員として登録されています。" : "Your PRO membership is active.") : (ja ? "無料プランをご利用中です。" : "You’re on the Free plan.")}</p>{member.plan === "pro" && !member.ownerMode && !member.testing && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > 0 && member.accessExpiresAt! <= 8_640_000_000_000_000 && <p>{ja ? "PRO利用期限：" : "PRO access until: "}<time dateTime={new Date(member.accessExpiresAt!).toISOString()}>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(member.accessExpiresAt)}</time></p>}<Link href="/research/columns">{ja ? "PROリサーチ・コラム" : "PRO Research & Columns"}</Link><Link href="/research/notifications">{ja ? "スマホ通知設定" : "Phone notifications"}</Link>{member.isAdmin && <Link href="/research/write">{ja ? "ひとりごとを書く" : "Write a note"}</Link>}{member.status === "signed-in" && member.isAdmin === true && <Link href="/research/review" prefetch={false}>{ja ? "ニュース配信状況" : "News delivery status"}</Link>}{member.isAdmin && <Link href="/api/research/member/export">{ja ? "登録者一覧をダウンロード" : "Download member list"}</Link>}<>{member.status === "signed-in" && (member.canTest === true || billingAvailable) && <Link href="/research/account/billing" prefetch={false}>{billingAvailable ? (ja ? "PROのお申し込み・契約管理" : "PRO subscription") : (ja ? "PROのテスト購入・契約確認" : "PRO test checkout & subscription")}</Link>}</><>{member.canTest && <PreviewControls ja={ja} testing={member.testing} onChange={() => setRetry(value => value + 1)} />}</><Link href="/research/account/security">{ja ? "パスワード・2段階認証の設定" : "Password & two-step verification"}</Link>{member.adminMfaRequired && <p role="alert">{ja ? "管理機能には2段階認証が必要です。設定後、ログインし直してください。" : "Admin access requires two-step verification. Set it up, then sign in again."}</p>}<SignOutButton redirectUrl="/research/account"><button>{ja ? "ログアウト" : "Sign out"}</button></SignOutButton></>}
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
  const returnTo = useAccountReturn();
  const [lang] = useResearchLanguage();
  return <>
    <p role="status">{lang === "ja" ? "ログインを完了しています…" : "Completing sign-in…"}</p>
    {returnTo !== null && <AuthenticateWithRedirectCallback
      signInUrl="/research/account"
      signUpUrl="/research/account/sign-up"
      signInForceRedirectUrl={returnTo}
      signUpForceRedirectUrl={returnTo}
    />}
  </>;
}

export default function AccountScreen(props: {status:string; plan:string; signingUp?:boolean; initialMember?:Member; billingAvailable?:boolean}) {
  const callback = useSyncExternalStore(subscribeCallbackRoute, isCallbackRoute, () => false);
  // Handle the OAuth return independently of the SignIn widget's hash router.
  // In particular, a nested return fragment must not leave an empty Clerk card.
  if (callback) return <AccountCallback />;
  if (props.status === "unavailable") return <AccountUnavailable />;
  return <AccountContent {...props} />;
}
