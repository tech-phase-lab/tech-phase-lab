"use client";
import { useSyncExternalStore } from "react";
import { cleanPushDiagnostic, PUSH_DIAG_EVENT, PUSH_DIAG_STORAGE_KEY, pushDiagnosticRows, type PushDiagnostic } from "@/lib/research/push-diagnostic";
import type { Language } from "@/lib/research/data";
import styles from "./notification-page.module.css";

const raw = () => { try { return window.localStorage.getItem(PUSH_DIAG_STORAGE_KEY) ?? ""; } catch { return ""; } };
function subscribe(notify: () => void) {
  window.addEventListener(PUSH_DIAG_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(PUSH_DIAG_EVENT, notify); window.removeEventListener("storage", notify); };
}

/** Owner account only (the caller decides): the steps the latest notice went through on this device, collapsed. */
export default function PushDiagnosticPanel({ lang }: { lang: Language }) {
  const text = useSyncExternalStore(subscribe, raw, () => "");
  let record: PushDiagnostic | null = null;
  try { record = text ? cleanPushDiagnostic(JSON.parse(text)) : null; } catch { record = null; }
  const ja = lang === "ja";
  return <details className={styles.diagnostic}>
    <summary>{ja ? "通知の動作の記録" : "Notification step record"}</summary>
    {record ? <dl className={styles.diagnosticList}>
      {pushDiagnosticRows(record, lang).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl> : <p className={styles.note}>{ja ? "まだ記録がありません。テスト通知を送ると記録されます。" : "Nothing recorded yet. Send a test notification to record one."}</p>}
    <p className={styles.note}>{ja ? "運営者のアカウントだけに表示されます。記録はサーバーのログにも送られます（番号と時刻のみ）。" : "Shown to the owner's account only. The record is also sent to the server log (id and times only)."}</p>
  </details>;
}
