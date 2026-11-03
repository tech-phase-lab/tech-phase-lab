"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./inbox-key.module.css";

type Status = { exists: boolean; createdAt: string | null; startUrl: string; finishUrl: string };
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
      setStatus({ exists: data.exists, createdAt: data.createdAt, startUrl: data.startUrl, finishUrl: data.finishUrl }); setState("ready");
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
      setKey(data.key); setStatus({ exists: true, createdAt: data.createdAt, startUrl: data.startUrl, finishUrl: data.finishUrl });
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
        <h2>送り先(ショートカットの「URL」は2つ)</h2>
        <p className={styles.note}>音声ファイルは大きいので、サイトを通さず保存先へ直接送ります。そのため、送り先が2つあります。</p>
        <p className={styles.note}>① 送る準備(保存先の住所をもらう)</p>
        <code>{status.startUrl}</code>
        <button type="button" className={styles.plain} onClick={() => void copy("start", status.startUrl)}>{copied === "start" ? "コピーしました" : "①をコピー"}</button>
        <p className={styles.note}>② 送り終わった知らせ(受信箱に入れる)</p>
        <code>{status.finishUrl}</code>
        <button type="button" className={styles.plain} onClick={() => void copy("finish", status.finishUrl)}>{copied === "finish" ? "コピーしました" : "②をコピー"}</button>
        <h2>ショートカットの作り方</h2>
        <ol>
          <li>共有シートで受け取る(ボイスメモの「共有」から)。</li>
          <li>「URLの内容を取得」を足し、URLに①を入れる。方法は「POST」、ヘッダーに <b>Authorization</b> を足し、値は <b>Bearer</b> と半角スペースのあとに鍵を続ける。</li>
          <li>もう1つ「URLの内容を取得」を足し、URLには、1つ前の「URLの内容」(保存先の住所)を入れる。方法は「PUT」、本文は「ファイル」にして、「ショートカットの入力」を入れる。</li>
          <li>3つ目の「URLの内容を取得」を足し、URLに②を入れる。方法は「POST」、ヘッダーは1つ目と同じ。</li>
          <li>最後に「通知を表示」を足し、3つ目の「URLの内容」を出す(「受信箱に届きました。」などの返事が出ます)。</li>
        </ol>
        <p className={styles.note}>作り直すと、古い鍵はすぐ使えなくなります。鍵そのものはサーバーに残さず、ハッシュだけを保存します。あとから見ることはできません。</p>
      </>}
      {message && <p role="status" className={styles.note}>{message}</p>}
    </section>
    <p><Link href="/research/notes" className={styles.back}>‹ ひとりごとに戻る</Link></p>
  </ResearchToolShell>;
}
