"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import { useIdentityRefresh } from "../../identity-provider";
import { billingRequest, billingReturn, billingSummary, sandboxApproval, verifyBillingReturn, type BillingSummary } from "@/lib/membership/billing-client";
import styles from "./styles.module.css";

const messages: Record<string, [string, string]> = {
  "identity-loading": ["ログイン状態を確認しています。", "Checking your sign-in status."],
  "billing-disabled": ["テスト購入の受付は停止中です。", "Test checkout is currently closed."],
  "sign-in": ["ログインし直してから再確認してください。", "Sign in again, then retry."],
  "owner-only": ["この画面は運営者専用です。", "This page is for the owner only."],
  "existing-subscription": ["手続き中の契約があります。同じ通貨で再開してください。", "A subscription is already pending. Resume in the same currency."],
  "reconciliation-required": ["再作成せず、契約の確認が必要です。", "The existing subscription needs review before retrying."],
  "settlement-review-required": ["支払いを確認できませんでした。運営側での確認が必要です。", "The payment needs manual review."],
  "subscription-not-cancellable": ["この状態では解約できません。契約状況を再確認してください。", "This subscription cannot be cancelled in its current state. Refresh its status."],
};
export default function BillingScreen() {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  const refreshIdentity = useIdentityRefresh();
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [currency, setCurrency] = useState<"JPY" | "USD">("JPY");
  const [agreed, setAgreed] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const automaticCheck = useRef<string | null>(null);
  const t = (jp: string, en: string) => ja ? jp : en;
  async function load(signal?: AbortSignal) {
    const configuration = await billingRequest("readiness", undefined, signal);
    if (signal?.aborted) return;
    const enabled = configuration.environment === "sandbox" && configuration.enabled === true && configuration.configurationReady === true;
    setReady(enabled);
    if (!enabled) { setSummary(null); setError("billing-disabled"); return; }
    const next = billingSummary(await billingRequest("status", undefined, signal));
    if (signal?.aborted) return;
    setSummary(next);
    setError("");
    if (next.subscription) setCurrency(next.subscription.currency);
    return next;
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const returned = billingReturn(window.location.search);
    if (returned.id && automaticCheck.current !== returned.id) setNotice(returned.cancelled ? "returned-cancelled" : "returned");
    // Callback values never grant access or trigger a new purchase.
    setBusy(true);
    refreshIdentity().then(() => load(controller.signal)).then(async current => {
      if (!current || controller.signal.aborted || !returned.id || returned.cancelled ||
          returned.id !== current.subscription?.id) return;
      if (current.plan === "pro" || current.reviewRequired) {
        setNotice(current.reviewRequired ? "review" : "verified"); return;
      }
      if (automaticCheck.current === returned.id) { setNotice("pending"); return; }
      automaticCheck.current = returned.id;
      setNotice("checking-payment");
      const result = await verifyBillingReturn(returned, current, controller.signal);
      if (!controller.signal.aborted) {
        if (result) { setSummary(result.summary); setNotice(result.notice); }
        else setNotice("pending");
      }
    })
      .catch(e => { if (!controller.signal.aborted) { setNotice(""); setReady(false); setSummary(null); setError(e instanceof Error ? e.message : "billing-unavailable"); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [refreshIdentity]);
  async function act(action: "refresh" | "create" | "reconcile" | "cancel") {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    // Notices describe one attempt; a refresh must not retain an earlier
    // pending/success message beside the newly loaded durable contract state.
    setNotice("");
    const signal = lifetime.current?.signal;
    try {
      await refreshIdentity(true);
      if (signal?.aborted) return;
      if (action === "create") {
        if (!agreed || !ready) throw Error("billing-disabled");
        const result = await billingRequest("create", { currency, acceptedTerms: "sandbox-v1" }, signal);
        if (signal?.aborted) return;
        if (result.approvalUrl) { window.location.assign(sandboxApproval(result.approvalUrl)); return; }
        setNotice("check-payment");
      } else if (action === "reconcile" || action === "cancel") {
        if (!summary?.subscription || (action === "cancel" && confirmCancel !== summary.subscription.id)) return;
        const result = await billingRequest(action, { id: summary.subscription.id }, signal);
        if (signal?.aborted) return;
        setNotice(action === "cancel" ? "cancelled" : result.status === "verified" ? "verified" : result.status === "review-required" ? "review" : "pending");
        setConfirmCancel(null);
      }
      await load(signal);
    } catch (e) {
      if (!signal?.aborted) {
        // A failed payment check can still have refreshed the contract state.
        // Read it once without retrying the mutation or retaining stale approval.
        setNotice(""); setError(e instanceof Error ? e.message : "billing-unavailable"); setReady(false); setSummary(null);
        if (action === "reconcile" || action === "cancel") {
          try {
            const current = billingSummary(await billingRequest("status", undefined, signal));
            if (!signal?.aborted) {
              setSummary(current);
              const interrupted = e instanceof Error &&
                (e.message === "billing-unavailable" || ["TypeError", "TimeoutError"].includes(e.name));
              if (interrupted && current.subscription?.id === summary?.subscription?.id) {
                if (action === "reconcile" && current.plan === "pro" && !current.reviewRequired) {
                  setError(""); setNotice("access-confirmed");
                } else if (action === "cancel" && current.subscription?.state === "cancelled") {
                  setError(""); setNotice("cancelled"); setConfirmCancel(null);
                }
              }
            }
          } catch { /* Keep the original error and no stale subscription state. */ }
        }
      }
    } finally { locked.current = false; if (!signal?.aborted) setBusy(false); }
  }
  const sub = summary?.subscription;
  const open = sub && !["cancelled", "expired"].includes(sub.state);
  const resumable = !open || ["creating", "approval_pending"].includes(sub.state);
  const errorText = messages[error]?.[ja ? 0 : 1] ?? t("通信を確認できませんでした。新しい契約を作らず、再確認してください。", "Could not confirm the result. Refresh before starting another subscription.");
  const notices: Record<string, string> = {
    returned: t("PayPalから戻りました。下の「支払いを確認」で結果を確認してください。", "You returned from PayPal. Use Verify payment below to check the result."),
    "returned-cancelled": t("PayPalでの承認を中断しました。契約の解約完了を意味するものではありません。", "PayPal approval was interrupted. This does not confirm subscription cancellation."),
    "check-payment": t("契約が見つかりました。支払いを確認してください。", "A subscription was found. Verify its payment."),
    "checking-payment": t("お支払いを確認しています。", "Checking your payment."),
    verified: t("支払いの照合が完了しました。利用状態は下に表示しています。", "Payment reconciliation finished. Access status is shown below."),
    "access-confirmed": t("保存済みのPRO利用状態を確認しました。利用期限は下に表示しています。", "Your saved PRO access is confirmed. Its expiry is shown below."),
    cancelled: t("自動更新を停止しました。確認済みの支払期間は保持されます。", "Automatic renewal stopped. Verified paid access is retained."),
    pending: t("支払いはまだ確認できていません。時間をおいて再確認してください。", "Payment has not been verified yet. Check again shortly."),
    review: t("この支払いには運営側での確認が必要です。", "This payment needs manual review."),
  };
  const states: Record<string, string> = {
    creating: t("手続きを準備中", "Preparing checkout"), approval_pending: t("PayPalでの承認待ち", "Awaiting PayPal approval"),
    active: t("契約中", "Active subscription"), suspended: t("契約停止中", "Suspended"), cancelled: t("自動更新停止済み", "Renewal cancelled"), expired: t("契約終了", "Expired"),
  };
  return <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={t("PRO テスト購入", "PRO test checkout")} description="">
    <section className={styles.card} aria-busy={busy}>
      <h2>PayPal Sandbox</h2>
      <p>{t("運営者専用のテストです。実際の請求や本番のPRO会員状態への変更はありません。PayPalのSandbox購入者アカウントを使用してください。", "Owner-only test. No real charge or production PRO membership change. Use a PayPal Sandbox buyer account.")}</p>
      {notice && !(notice === "verified" && summary?.reviewRequired) && <p role="status">{notices[notice]}</p>}
      {error && <p role={error === "identity-loading" ? "status" : "alert"}>{errorText}</p>}
      {summary && <div>
        {summary.reviewRequired && <p role="status">{t("この契約のお支払いは運営側での確認が必要です。", "Payment for this subscription needs review.")}</p>}
        <p>{t("契約状況：", "Subscription: ")}{sub ? states[sub.state] : t("契約なし", "None")}</p>
        <p>{t("テスト環境の利用状態：", "Sandbox access: ")}{summary.plan.toUpperCase()}</p>
        {summary.proExpiresAt && <p>{t("確認済みの利用期限：", "Verified access until: ")}<time dateTime={summary.proExpiresAt}>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(summary.proExpiresAt))} JST</time></p>}
      </div>}
      <button type="button" disabled={busy} onClick={() => void act("refresh")}>{busy ? t("確認中…", "Checking…") : t("契約状況を再確認", "Refresh subscription")}</button>
      {ready && summary && resumable && <fieldset disabled={busy}>
        <legend>{t("月額プラン", "Monthly plan")}</legend>
        <label>{t("通貨", "Currency")}<select value={currency} disabled={Boolean(open)} onChange={e => { setCurrency(e.target.value as "JPY" | "USD"); setAgreed(false); }}><option value="JPY">JPY 2,980 / {t("月", "month")}</option><option value="USD">USD 20 / {t("月", "month")}</option></select></label>
        <label className={styles.check}><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />{t("Sandbox内で毎月自動更新されるテスト契約に同意します。実際の請求はありません。", "I agree to a monthly recurring Sandbox test subscription. There is no real charge.")}</label>
        <button type="button" disabled={!agreed || busy} onClick={() => void act("create")}>{open ? t("PayPalで手続きを再開", "Resume on PayPal") : t("PayPalでテスト購入", "Test checkout with PayPal")}</button>
      </fieldset>}
      {ready && sub && sub.state !== "creating" && <button type="button" disabled={busy} onClick={() => void act("reconcile")}>{t("支払いを確認", "Verify payment")}</button>}
      {ready && sub && ["active", "suspended"].includes(sub.state) && <fieldset disabled={busy}>
        <legend>{t("自動更新を停止", "Stop automatic renewal")}</legend>
        <label className={styles.check}><input type="checkbox" checked={confirmCancel === sub.id} onChange={e => setConfirmCancel(e.target.checked ? sub.id : null)} />{t("次回以降の自動更新を停止します。", "Stop future automatic renewals.")}</label>
        <button type="button" disabled={confirmCancel !== sub.id || busy} onClick={() => void act("cancel")}>{t("テスト契約を解約", "Cancel test subscription")}</button>
      </fieldset>}
      <Link href="/research/account">{t("マイアカウントへ戻る", "Back to my account")}</Link>
    </section>
  </ResearchToolShell>;
}
