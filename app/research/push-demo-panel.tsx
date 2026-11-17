"use client";
import { useState } from "react";
import { DEMO_LANGUAGES, demoPriceTargetText, type DemoLanguage } from "@/lib/research/push-demo-notice";
import type { Language } from "@/lib/research/data";
import styles from "./notification-page.module.css";

/** Nov 17 (owner): 「動画撮影用：目標株価のデモ通知」. Sends one sample price-target notice, in the real notice's format, to this device
 * only, in Japanese or English. The caller shows it in owner mode only; the server refuses everyone else before the monitor. */
export default function PushDemoPanel({ lang, on }: { lang: Language; on: boolean }) {
  const ja = lang === "ja";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [nextAt, setNextAt] = useState(0);
  async function send(language: DemoLanguage) {
    if (busy) return;
    if (Date.now() < nextAt) { setMessage(ja ? "次のデモ通知は1分後に送れます。" : "Wait one minute before sending another demo notice."); return; }
    setBusy(true); setMessage("");
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/research") : undefined;
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) throw new Error(ja ? "この端末の通知がオンになっていません。" : "Notifications are not on for this device.");
      setNextAt(Date.now() + 60_000);
      const response = await fetch("/api/research/notifications", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "demo-target", language, subscription: subscription.toJSON() }),
        signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => null) as { ok?: boolean; accepted?: boolean; retryAfter?: number; expired?: boolean; error?: string } | null;
      if (response.status === 403) throw new Error(ja ? "運営者モードでのみ送れます。" : "Available in owner mode only.");
      if (!response.ok || !result) throw new Error(ja ? "接続できませんでした。1分後にもう一度お試しください。" : "Unable to connect. Try again in one minute.");
      if (result.ok === false) throw new Error(result.error === "not-registered" || result.error === "not-owned"
        ? (ja ? "この端末の通知登録が見つかりません。通知をオンにし直してください。" : "This device is not registered. Turn notifications on again.")
        : (ja ? "送れませんでした。" : "Could not send."));
      setMessage(result.accepted ? (ja ? "送信しました。この端末に届きます。" : "Sent. It will arrive on this device.")
        : result.retryAfter ? (ja ? "次のデモ通知は1分後に送れます。" : "Wait one minute before sending another demo notice.")
        : result.expired ? (ja ? "端末の通知登録が期限切れです。通知をオンにし直してください。" : "This device subscription expired. Turn notifications on again.")
        : (ja ? "通知サービスに受け付けられませんでした。1分後に再試行できます。" : "The push service did not accept it. You can retry in one minute."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ja ? "接続を確認してください。" : "Check your connection.");
    } finally { setBusy(false); }
  }
  return <section aria-labelledby="push-demo-heading">
    <p className={styles.section} id="push-demo-heading">{ja ? "動画撮影用：目標株価のデモ通知" : "For filming: demo price-target notice"}</p>
    <p className={styles.note}>{ja ? "本物の目標株価通知と同じ見た目で、この端末にだけ1件送ります（架空の数字）。タップで目標株価ページが開きます。"
      : "Sends one notice to this device only, looking exactly like a real price-target notice (fictional numbers). A tap opens the price-target page."}</p>
    <dl className={styles.diagnosticList}>
      {DEMO_LANGUAGES.map(language => {
        const text = demoPriceTargetText(language);
        return <div key={language}><dt>{language === "ja" ? (ja ? "日本語" : "Japanese") : (ja ? "英語" : "English")}</dt>
          <dd><b>{text.title}</b><br />{text.body}</dd></div>;
      })}
    </dl>
    <div className={styles.aux}>
      <button type="button" className={styles.testButton} disabled={busy || !on} onClick={() => void send("ja")}>{ja ? "日本語で送る" : "Send in Japanese"}</button>
      <button type="button" className={styles.testButton} disabled={busy || !on} onClick={() => void send("en")}>{ja ? "英語で送る" : "Send in English"}</button>
    </div>
    {!on && <p className={styles.note}>{ja ? "先にこの端末の通知をオンにしてください。" : "Turn notifications on for this device first."}</p>}
    {busy && <p className={styles.note} role="status">{ja ? "送信中…" : "Sending…"}</p>}
    {message && <p className={styles.note} role="status">{message}</p>}
  </section>;
}
