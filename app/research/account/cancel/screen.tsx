"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import { billingRequest, billingSummary } from "@/lib/membership/billing-client";
import { monthDay } from "@/lib/research/month-day";
import { PRO_ONLY_FEATURES } from "@/lib/research/pro-features";
import { useIdentityRefresh } from "../../identity-provider";
import { UpgradeSheet } from "../account-sheets";
import { getJson, readContract, type Contract } from "../account-data";
import styles from "./styles.module.css";

type Mode = "live" | "sandbox";
type View = { state: "loading" } | { state: "error" } | { state: "ready"; contract: Contract };
const checkMark = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

export default function CancelScreen({ mode }: { mode: Mode }) {
  const [lang, setLang] = useResearchLanguage(), ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [view, setView] = useState<View>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [resume, setResume] = useState(false);
  const refreshIdentity = useIdentityRefresh();
  const locked = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setView({ state: "ready", contract: readContract(await getJson("/api/research/account/contract", signal)) }); }
    catch { if (!signal?.aborted) setView({ state: "error" }); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function cancel() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try {
      // The same two calls the account page used for "自動更新を停止する": find this member's contract, then stop its renewal.
      const signal = AbortSignal.timeout(30_000);
      const current = billingSummary(await billingRequest("status", undefined, signal, mode), mode);
      const sub = current.subscription;
      if (!sub || !["active", "suspended"].includes(sub.state)) throw new Error("not-cancellable");
      await billingRequest("cancel", { id: sub.id }, signal, mode);
      setDone(true);
      await load();
    } catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  }
  const contract = view.state === "ready" ? view.contract : null;
  const until = monthDay(contract?.accessExpiresAt ?? contract?.nextBillingAt, ja);
  const stopped = contract?.status === "renewal-stopped";
  const active = contract?.status === "active" && contract.verification === "verified";
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("解約の手続き", "Cancel membership")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      {(done || stopped) && until ? <>
        <div className={styles.doneMark}>{checkMark}</div>
        <h1 className={styles.doneTitle}>{t("解約を受け付けました", "Cancellation received")}</h1>
        <p className={styles.doneText}>{t(`${until}まではPROをお使いいただけます。`, `You can use PRO until ${until}.`)}<br />{t("また使いたくなったら、いつでも再開できます。", "You can come back whenever you like.")}</p>
        <button type="button" className={`${styles.big} ${styles.outline}`} onClick={() => setResume(true)}>{t("PROを再開する", "Resume PRO")}</button>
        <Link className={`${styles.big} ${styles.plain}`} href="/research">{t("ホームへ戻る", "Back to home")}</Link>
        <p className={styles.note}>{t("再開すると、PayPalでもう一度、お申し込みの確認をします。", "Resuming asks you to confirm with PayPal again.")}</p>
      </> : <>
        <Link className={styles.back} href="/research/account">‹ {t("プランの管理", "Manage plan")}</Link>
        <h1 className={styles.title}>{t("解約の手続き", "Cancel membership")}</h1>
        {view.state === "loading" && <p role="status" aria-busy="true">{t("契約を確認しています…", "Checking your contract…")}</p>}
        {view.state === "error" && <p role="alert">{t("契約の状態を確認できませんでした。時間をおいて、もう一度お試しください。", "Could not check your contract. Please try again shortly.")}</p>}
        {contract && !active && <p role="status">{t("いま、解約できる契約はありません。", "There is no contract to cancel right now.")}</p>}
        {active && <>
          {until && <div className={styles.until}><span className={styles.mark}>{checkMark}</span><div><b>{t(`${until}まではPROを使えます`, `PRO stays available until ${until}`)}</b><span>{t("今すぐ使えなくなることはありません", "You will not lose access right away")}</span></div></div>}
          <p className={styles.lead}>{t("解約すると使えなくなるもの", "What you lose when PRO ends")}</p>
          <ul className={styles.list}>{PRO_ONLY_FEATURES.map(feature => <li key={feature.ja}><b>{ja ? feature.ja : feature.en}</b><span>{ja ? feature.descriptionJa : feature.descriptionEn}</span></li>)}</ul>
          <p className={styles.keep}>{t("お気に入りと通知の設定は残ります。戻ってきたときは、そのまま再開できます。", "Your favorites and notification settings stay. If you come back, you can pick up where you left off.")}</p>
          {error && <p className={styles.err} role="alert">{t("解約できませんでした。契約の状態を確認して、もう一度お試しください。", "Could not cancel. Check your contract and try again.")}</p>}
          <Link className={`${styles.big} ${styles.go}`} href="/research/account">{t("PROを続ける", "Keep PRO")}</Link>
          <button type="button" className={`${styles.big} ${styles.stop}`} disabled={busy} onClick={() => void cancel()}>{busy ? t("手続きしています…", "Processing…") : t("解約する", "Cancel")}</button>
        </>}
      </>}
    </div>
    {resume && <UpgradeSheet ja={ja} mode={mode} refresh={refreshIdentity} onClose={() => setResume(false)} />}
  </ResearchToolShell>;
}
