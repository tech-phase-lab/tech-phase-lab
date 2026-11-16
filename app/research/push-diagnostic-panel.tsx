"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cleanPushDiagnostic, PUSH_DIAG_EVENT, PUSH_DIAG_STORAGE_KEY, pushDiagnosticRows, type PushDiagnostic } from "@/lib/research/push-diagnostic";
import { pushSwFactRows, readPushSwFacts, reinstallMessage, type ContainerLike, type PushSwFacts, type ReinstallResult } from "@/lib/research/push-sw-facts";
import { cleanPushSendLog, pushDeviceRef, pushSendRows, type PushSend } from "@/lib/research/push-send-log";
import { cleanPushServerNotice, pushServerNoticeRows, type PushServerNotice } from "@/lib/research/push-server-notice";
import type { Language } from "@/lib/research/data";
import styles from "./notification-page.module.css";

const raw = () => { try { return window.localStorage.getItem(PUSH_DIAG_STORAGE_KEY) ?? ""; } catch { return ""; } };
function subscribe(notify: () => void) {
  window.addEventListener(PUSH_DIAG_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(PUSH_DIAG_EVENT, notify); window.removeEventListener("storage", notify); };
}
function liveFacts(): Promise<PushSwFacts> {
  return readPushSwFacts({
    container: "serviceWorker" in navigator ? navigator.serviceWorker as unknown as ContainerLike : undefined,
    caches: typeof caches === "undefined" ? undefined : caches as never,
    origin: window.location.origin,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    standalone: typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true : null,
  });
}

/** Nov 16: the monitor's last sends (owner accounts only on the server) and this device's short hash, to tell which one is this phone. */
async function liveSends(): Promise<{ items: PushSend[]; current: string | null }> {
  let current: string | null = null;
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/research") : undefined;
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription?.endpoint && globalThis.crypto?.subtle) current = await pushDeviceRef(subscription.endpoint);
  } catch { current = null; }
  const response = await fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send-log" }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => null) as { ok?: unknown; items?: unknown } | null;
  if (!response.ok || result?.ok !== true) throw new Error("send-log");
  return { items: cleanPushSendLog(result.items), current };
}

/** Nov 16: the newest notice the server sent this device (sent time, opened or dismissed), from the server's own record. */
async function liveNotice(): Promise<PushServerNotice | null> {
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/research") : undefined;
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return null;
  const response = await fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notice-status", subscription: subscription.toJSON() }),
    signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => null) as { ok?: unknown; notice?: unknown } | null;
  if (!response.ok || result?.ok !== true) throw new Error("notice-status");
  return cleanPushServerNotice(result.notice);
}

/** Owner account only (the caller decides): what is installed on this device, the steps the latest notice went through, and a button
 * that installs the notification worker afresh. Collapsed. */
export default function PushDiagnosticPanel({ lang, onReinstall }: { lang: Language; onReinstall?: () => Promise<ReinstallResult> }) {
  const text = useSyncExternalStore(subscribe, raw, () => "");
  const [facts, setFacts] = useState<PushSwFacts | null>(null);
  const [reading, setReading] = useState(0);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState("");
  const [sends, setSends] = useState<{ items: PushSend[]; current: string | null } | "error" | null>(null);
  const [notice, setNotice] = useState<{ value: PushServerNotice | null } | "error" | null>(null);
  useEffect(() => {
    let active = true;
    liveFacts().then(value => { if (active) setFacts(value); }).catch(() => { /* shown as still reading */ });
    liveSends().then(value => { if (active) setSends(value); }).catch(() => { if (active) setSends("error"); });
    liveNotice().then(value => { if (active) setNotice({ value }); }).catch(() => { if (active) setNotice("error"); });
    return () => { active = false; };
  }, [reading]);
  let record: PushDiagnostic | null = null;
  try { record = text ? cleanPushDiagnostic(JSON.parse(text)) : null; } catch { record = null; }
  const ja = lang === "ja";
  async function reinstall() {
    if (!onReinstall || working) return;
    setWorking(true); setResult("");
    try { setResult(reinstallMessage(await onReinstall(), lang)); }
    catch { setResult(ja ? "入れ直しに失敗しました。アプリを閉じて開き直してから、もう一度お試しください。" : "Reinstall failed. Close and reopen the app, then try again."); }
    finally { setWorking(false); setReading(value => value + 1); }
  }
  return <details className={styles.diagnostic}>
    <summary>{ja ? "通知の動作の記録" : "Notification step record"}</summary>
    <p className={styles.note}>{ja ? "この端末の状態（いま読み取った値）" : "This device now (read live)"}</p>
    {facts ? <dl className={styles.diagnosticList}>
      {pushSwFactRows(facts, lang).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl> : <p className={styles.note}>{ja ? "読み取り中…" : "Reading…"}</p>}
    {onReinstall && <p><button type="button" className={styles.testButton} disabled={working} onClick={() => void reinstall()}>
      {working ? (ja ? "入れ直し中…" : "Reinstalling…") : (ja ? "通知の仕組みを入れ直す" : "Reinstall the notification worker")}</button></p>}
    {result && <p className={styles.note} role="status">{result}</p>}
    <p className={styles.note}>{ja ? "サーバーからの送信（直近10件・新しい順）" : "Sends from the server (last 10, newest first)"}{" "}
      <button type="button" className={styles.testButton} onClick={() => { setSends(null); setNotice(null); setReading(value => value + 1); }}>{ja ? "再読み込み" : "Reload"}</button></p>
    {sends === null ? <p className={styles.note}>{ja ? "読み取り中…" : "Reading…"}</p>
      : sends === "error" ? <p className={styles.note}>{ja ? "読み取れませんでした。" : "Could not read the send log."}</p>
      : sends.items.length === 0 ? <p className={styles.note}>{ja ? "サーバーの再起動後、まだ送信がありません。" : "No sends since the server last started."}</p>
      : <dl className={styles.diagnosticList}>
        {pushSendRows(sends.items, lang, sends.current).map(row => <div key={row.key}><dt>{row.time}</dt><dd>{row.mine ? <strong>{row.label}</strong> : row.label}<br />{row.detail}</dd></div>)}
      </dl>}
    <p className={styles.note}>{ja ? "サーバーの記録（この端末への最新の通知・アプリ内バナー用）" : "Server record (newest notice to this device, for the in-app banner)"}</p>
    {notice === null ? <p className={styles.note}>{ja ? "読み取り中…" : "Reading…"}</p>
      : notice === "error" ? <p className={styles.note}>{ja ? "読み取れませんでした。" : "Could not read the server record."}</p>
      : <dl className={styles.diagnosticList}>
        {pushServerNoticeRows(notice.value, lang).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
      </dl>}
    <p className={styles.note}>{ja ? "最新の通知の記録" : "Latest notice"}</p>
    {record ? <dl className={styles.diagnosticList}>
      {pushDiagnosticRows(record, lang).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl> : <p className={styles.note}>{ja ? "まだ記録がありません。テスト通知を送ると記録されます。" : "Nothing recorded yet. Send a test notification to record one."}</p>}
    <p className={styles.note}>{ja ? "運営者のアカウントだけに表示されます。記録はサーバーのログにも送られます（番号と時刻のみ）。" : "Shown to the owner's account only. The record is also sent to the server log (id and times only)."}</p>
  </details>;
}
