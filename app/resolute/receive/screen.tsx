"use client";
import { useEffect, useRef, useState } from "react";
import { SignIn, SignUp, useAuth, useUser } from "@clerk/nextjs";
import styles from "../checkout/styles.module.css";

export default function ReceiveScreen({ language, hasLink, signingUp, orderId }: { orderId: string | null; language: "ja" | "en"; hasLink: boolean; signingUp: boolean }) {
  const [expectedOrder, setExpectedOrder] = useState(orderId);
  const en = language === "en", target = `/resolute/receive?lang=${language}${expectedOrder ? `&order=${expectedOrder}` : ""}`;
  const { isLoaded, isSignedIn, sessionId } = useAuth(), { user } = useUser();
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [claimedSession, setClaimedSession] = useState<string | null>(null);
  const claimed = Boolean(sessionId && claimedSession === sessionId);
  const link = useRef<string | null>(null), pending = useRef<Promise<string> | null>(null), lock = useRef(false);
  const currentSession = useRef(sessionId); currentSession.current = sessionId;
  useEffect(() => {
    let active = true;
    // Strip the secret before mounting third-party sign-in UI. Never put it in a query or storage.
    if (/^#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(window.location.hash) && !link.current) {
      link.current = window.location.hash.slice(1);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (link.current) {
      pending.current ??= fetch("/api/resolute/receive", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.current }),
      }).then(async r => { const data = await r.json(); if (!r.ok || data.ready !== true || typeof data.orderId !== "string" || !/^[a-f0-9-]{36}$/.test(data.orderId)) throw Error("INVALID_RECOVERY_LINK"); return data.orderId; });
      pending.current.then(id => { if (active) {
        setExpectedOrder(id); setReady(true);
        const location = new URL(window.location.href); location.searchParams.set("order", id);
        window.history.replaceState(null, "", location.pathname + location.search);
      } }).catch(() => { if (active) setError("LINK_FAILED"); });
    } else if (hasLink && orderId) setReady(true);
    else setError("LINK_MISSING");
    return () => { active = false; };
  }, [hasLink, orderId]);
  async function claim() {
    if (lock.current || !ready || !isSignedIn || !sessionId || !expectedOrder) return;
    const account = sessionId; lock.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/resolute/live-payments/recovery/claim", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: expectedOrder }),
      });
      const data = await r.json();
      if (!r.ok || data.sandbox !== false || !["claimed", "already-claimed"].includes(data.state)) throw Error(data.error ?? "RECEIVE_FAILED");
      if (currentSession.current === account) setClaimedSession(account);
    } catch (e) { if (currentSession.current === account) setError(e instanceof Error ? e.message : "RECEIVE_FAILED"); }
    finally { lock.current = false; setBusy(false); }
  }
  const errors: Record<string, string> = {
    LINK_MISSING: en ? "Open the link in your purchase email." : "購入後の案内メールにあるリンクから開いてください。",
    LINK_FAILED: en ? "We couldn’t open the link. Open it again from your email." : "リンクを確認できませんでした。案内メールからもう一度開いてください。",
    RECOVERY_EXPIRED: en ? "This link has expired. Contact support with your order number. Do not purchase again." : "リンクの期限が切れています。再購入せず、注文番号を添えてお問い合わせください。",
    ALREADY_PURCHASED: en ? "This account already owns RESOLUTE. Contact support before connecting another purchase." : "このアカウントはRESOLUTEを購入済みです。別の購入を紐づける前にお問い合わせください。",
  };
  return <main className={styles.page}><section className={styles.card}>
    <p className={styles.badge}>RESOLUTE</p><h1>{en ? "Receive your purchase" : "購入したRESOLUTEを受け取る"}</h1>
    {claimed ? <><p role="status">{en ? "Your purchase is connected to your account." : "このアカウントで受け取りが完了しました。"}</p><a className={styles.button} href={`/resolute?lang=${language}`}>{en ? "Open RESOLUTE" : "RESOLUTEを開く"}</a></> : <>
      <p>{en ? "Sign in or create an account, then confirm the account that will receive your purchase. Your included year starts on the payment date." : "ログインまたはアカウントを作成し、受け取るアカウントを確認してください。1年間の対象期間は決済日から始まります。"}</p>
      {expectedOrder && <p className={styles.orderId}>{en ? "Order: " : "注文番号："}{expectedOrder}</p>}
      {ready && isLoaded && (isSignedIn ? <><p>{user?.primaryEmailAddress?.emailAddress}</p><button disabled={busy} onClick={() => void claim()}>{en ? "Connect to this account" : "このアカウントで受け取る"}</button></> : signingUp ?
        <SignUp routing="hash" forceRedirectUrl={target} signInUrl={target}/> :
        <SignIn routing="hash" forceRedirectUrl={target} signUpForceRedirectUrl={target} signUpUrl={`${target}&signup=1`}/>)}
      {(!ready || !isLoaded) && !error && <p role="status">{en ? "Preparing your purchase…" : "受け取りの準備をしています…"}</p>}
    </>}
    {busy && <p role="status">{en ? "Connecting…" : "受け取りを確認しています…"}</p>}
    {error && <p role="alert">{errors[error] ?? (en ? "We couldn’t connect this purchase. Check that you’re using the correct account. Do not purchase again; contact support with your order number if this continues." : "受け取りを確認できませんでした。ログイン中のアカウントを確認してください。解決しない場合は再購入せず、注文番号を添えてお問い合わせください。")}</p>}
  </section></main>;
}
