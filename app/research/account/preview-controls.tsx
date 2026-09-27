"use client";
import { useState } from "react";
import styles from "./styles.module.css";
export default function PreviewControls({ ja, testing, onChange }: { ja: boolean; testing: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function change(mode: string) {
    setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/research/member/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }), signal: AbortSignal.timeout(15_000) });
      if (!result.ok) throw new Error();
      onChange();
      window.dispatchEvent(new Event("tech-phase:membership-changed"));
      setMessage(mode === "expiring" ? (ja ? "1分後に期限切れになります。「会員状態を再確認」で確認できます。" : "Expires in one minute. Select Refresh membership to check.") : (ja ? "会員状態を更新しました。" : "Membership updated."));
    } catch { setMessage(ja ? "変更できませんでした。再度お試しください。" : "Could not update. Please retry."); }
    finally { setBusy(false); }
  }
  return <details className={styles.preview}><summary>{ja ? "運営者用：会員機能の確認" : "Admin: membership testing"}</summary>
    <p>{ja ? "自分のアカウントだけで確認します。課金や契約の変更はありません。試験状態は1時間で解除されます。" : "Test your own account without billing or subscription changes. Test mode clears after one hour."}</p>
    {testing && <p>{ja ? "現在：会員機能を試験中" : "Membership test active"}</p>}
    <div className={styles.testButtons}>{[["free", "FREEで確認", "Test Free"], ["pro", "PROで確認", "Test Pro"], ["expiring", "1分後に期限切れ", "Expire in one minute"], ["restore", "試験を終了", "End test"]].map(([mode, label, en]) => <button type="button" disabled={busy} key={mode} onClick={() => void change(mode)}>{ja ? label : en}</button>)}
    <button type="button" disabled={busy} onClick={onChange}>{ja ? "会員状態を再確認" : "Refresh membership"}</button></div>
    <p role="status">{message}</p>
  </details>;
}
