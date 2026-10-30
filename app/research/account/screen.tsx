"use client";
import { AuthenticateWithRedirectCallback, SignIn, SignUp, useAuth } from "@clerk/nextjs";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "../identity-provider";
import { readAccountReturn } from "@/lib/research/account-return";
import AccountView from "./account-view";
import styles from "./styles.module.css";
const subscribeReturn = () => () => {};
function returnSnapshot() {
  try { return readAccountReturn(window.sessionStorage); } catch { return "/research/account"; }
}
const upgradeSnapshot = () => new URLSearchParams(window.location.search).get("upgrade") === "1";
function useUpgradeFirst() { return useSyncExternalStore(subscribeReturn, upgradeSnapshot, () => false); }
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
  const upgradeFirst = useUpgradeFirst();
  // The redesigned account screen (canvas A1-A11) replaces the old signed-in card.
  if (member.status === "signed-in" && isLoaded && isSignedIn) return <ResearchToolShell showTools={false} showHeading={false} lang={lang} setLang={setLang} title={ja ? "アカウント" : "Account"} description="">
    <AccountView ja={ja} member={member} billingAvailable={billingAvailable} upgradeFirst={upgradeFirst} onRecheck={() => setRetry(value => value + 1)} />
  </ResearchToolShell>;
  const content = <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "マイアカウント" : "My account"} description="">
    <section className={styles.card}>
      {member.status === "unavailable" ? <><h2>{ja ? "会員情報を確認できませんでした" : "Could not verify your membership"}</h2><p>{ja ? "時間をおいて、もう一度お試しください。" : "Please wait a moment and try again."}</p><button onClick={() => setRetry(value => value + 1)}>{ja ? "再確認" : "Try again"}</button><Link href="/research">{ja ? "ホームへ戻る" : "Back to home"}</Link></> : (!isLoaded || returnTo === null || (isSignedIn && member.status === "signed-out")) && member.status !== "signed-in" ? <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "ログイン画面を準備しています" : "Loading sign-in"} /> : member.status === "signed-out" ? (signingUp ? <SignUp routing="hash" signInUrl="/research/account" forceRedirectUrl={returnTo ?? "/research/account"} /> : <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl={returnTo ?? "/research/account"} />) : null}
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
