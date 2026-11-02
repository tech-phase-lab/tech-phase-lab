"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./inbox-key.module.css";

type Status = { exists: boolean; createdAt: string | null; uploadUrl: string };
const when = (iso: string) => new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Tokyo" }).format(new Date(iso));

/** Make the inbox key: it is shown once, here, and never again. A new key replaces the old one at once. */
export default function InboxKeyScreen() {
  const [lang, setLang] = useResearchLanguage();
  const [status, setStatus] = useState<Status | null>(null), [key, setKey] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [copied, setCopied] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/desk-inbox/key", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      setStatus({ exists: data.exists, createdAt: data.createdAt, uploadUrl: data.uploadUrl }); setState("ready");
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, []);
  async function create() {
    if (busy) return;
    if (status?.exists && !window.confirm("新しい鍵を作ると、いまの鍵はすぐ使えなくなります。ショートカットの鍵を入れ替える必要があります。作りますか？")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/research/desk-inbox/key", { method: "POST", signal: AbortSignal.timeout(15_000) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      setKey(data.key); setStatus({ exists: true, createdAt: data.createdAt, uploadUrl: data.uploadUrl });
    } catch { setMessage("鍵を作れませんでした。時間をおいて、もう一度お試しください。"); }
    finally { setBusy(false); }
  }
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(""), 2000); } catch { setMessage("コピーできませんでした。選んで、手でコピーしてください。"); }
  }
  return <ResearchToolShell desk lang={lang} setLang={setLang} title="受信箱の鍵" description="iPhoneのショートカットから、ボイスメモを受信箱へ直接送るための鍵です。">
    <section className={styles.card}>
      {state === "loading" && <p role="status">読み込んでいます…</p>}
      {state === "error" && <p role="status">鍵の状態を読み込めませんでした。時間をおいて、再読み込みしてください。</p>}
      {state === "ready" && status && <>
        <p className={styles.state}>{status.exists ? <>鍵は作成済みです<small>{status.createdAt ? `作成: ${when(status.createdAt)}` : ""}</small></> : "まだ鍵がありません"}</p>
        <button type="button" className={styles.make} disabled={busy} onClick={() => void create()}>{busy ? "作っています…" : "新しく作る"}</button>
        {key && <div className={styles.once} role="alert">
          <b>この鍵は、いまだけ表示されます。</b>
          <p>この画面を閉じると、もう見られません。ショートカットに貼ってから、閉じてください。</p>
          <code>{key}</code>
          <button type="button" onClick={() => void copy("key", key)}>{copied === "key" ? "コピーしました" : "鍵をコピー"}</button>
        </div>}
        <h2>送り先(ショートカットの「URL」)</h2>
        <code>{status.uploadUrl}</code>
        <button type="button" className={styles.plain} onClick={() => void copy("url", status.uploadUrl)}>{copied === "url" ? "コピーしました" : "送り先をコピー"}</button>
        <h2>ショートカットの作り方</h2>
        <ol>
          <li>共有シートで受け取る(ボイスメモの「共有」から)。</li>
          <li>「URLの内容を取得」を足し、URLに上の送り先を入れる。</li>
          <li>方法は「POST」、本文は「フォーム」にして、項目名「file」に共有された音声を入れる。</li>
          <li>ヘッダーに <b>Authorization</b> を足し、値は <b>Bearer</b> と半角スペースのあとに鍵を続けて入れる。</li>
          <li>最後に「通知を表示」を足し、取得した内容をそのまま出す(「受信箱に届きました。」などの返事が出ます)。</li>
        </ol>
        <p className={styles.note}>作り直すと、古い鍵はすぐ使えなくなります。鍵そのものはサーバーに残さず、ハッシュだけを保存します。あとから見ることはできません。</p>
      </>}
      {message && <p role="status" className={styles.note}>{message}</p>}
    </section>
    <p><Link href="/research/notes" className={styles.back}>‹ ひとりごとに戻る</Link></p>
  </ResearchToolShell>;
}
