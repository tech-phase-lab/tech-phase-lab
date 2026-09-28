"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";

type Question = { id: string; body: string; status: "pending" | "answered" | "closed"; answerPostId: string | null; createdAt: string };
const nextId = () => `q-${crypto.randomUUID().replaceAll("-", "")}`;
const labels = { pending: { ja: "受付済み", en: "Received" }, answered: { ja: "回答を公開", en: "Answered" }, closed: { ja: "今回は掲載なし", en: "Not selected" } } as const;

export default function Questions() {
  const [lang, setLang] = useResearchLanguage();
  const [items, setItems] = useState<Question[]>([]);
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ja = lang === "ja";
  useEffect(() => { setRequestId(nextId()); const controller = new AbortController(); fetch("/api/research/questions", { cache: "no-store", signal: controller.signal }).then(async response => ({ response, data: await response.json() })).then(({ response, data }) => { if (response.status === 401) { setState("signed-out"); return; } if (!response.ok || !data.ok || !Array.isArray(data.items)) throw Error(); setItems(data.items); setState("ready"); }).catch(error => { if (error.name !== "AbortError") setState("error"); }); return () => controller.abort(); }, []);
  async function submit() {
    if (body.trim().length < 10 || !requestId) return;
    setBusy(true); setMessage(ja ? "送信しています…" : "Submitting…");
    try {
      const response = await fetch("/api/research/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, body }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.item) throw Error(data.error || "failed");
      setItems(current => [data.item, ...current.filter(item => item.id !== data.item.id)]); setBody(""); setRequestId(nextId());
      setMessage(ja ? "非公開で受け付けました。採用した質問は、確認・編集後に回答ページへ掲載します。" : "Received privately. Selected questions may appear on the answered page after review and editing.");
    } catch { setMessage(ja ? "送信を完了できませんでした。入力は残っています。通信を確認して、もう一度お試しください。" : "Submission did not complete. Your text is still here; check the connection and try again."); }
    finally { setBusy(false); }
  }
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "リゼルに聞く" : "Ask RIZEL"} description={ja ? "投資や企業分析で気になっていることを、会員アカウントから非公開で送れます。" : "Send a private investing or company-research question from your member account."}>
    <nav className={styles.views} aria-label={ja ? "質問メニュー" : "Question views"}><span aria-current="page">{ja ? "質問を送る" : "Ask a question"}</span><Link href="/research/qa/answered">{ja ? "公開された回答" : "Published answers"}</Link></nav>
    {state === "loading" && <p role="status">{ja ? "会員情報を確認中…" : "Checking your account…"}</p>}
    {state === "signed-out" && <section className={styles.card}><h2>{ja ? "ログインすると質問できます" : "Sign in to ask"}</h2><p>{ja ? "質問本文は公開されません。運営者がテーマを選び、個人情報を除いて回答記事を作成します。すべての質問への回答はお約束していません。" : "Your submitted text is private. The editor may select a topic and publish an answer without personal details. Not every question will receive an answer."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></section>}
    {state === "error" && <p role="status">{ja ? "質問機能に接続できませんでした。時間をおいて再読み込みしてください。" : "Questions are temporarily unavailable. Please reload later."}</p>}
    {state === "ready" && <><section className={styles.card} aria-busy={busy}><h2>{ja ? "質問を書く" : "Write your question"}</h2><p>{ja ? "10〜1,200文字。個人情報、口座番号、連絡先は書かないでください。内容を確認してから送信します。" : "10–1,200 characters. Do not include personal details, account numbers, or contact information. Review before submitting."}</p><label>{ja ? "質問" : "Question"}<textarea autoFocus maxLength={1200} value={body} onChange={event => setBody(event.target.value)} placeholder={ja ? "例：決算で、売上高より先に確認したい数字は？" : "Example: Which earnings metric should I check before revenue?"} /></label><div className={styles.submit}><small>{body.length.toLocaleString()} / 1,200</small><button disabled={busy || body.trim().length < 10} onClick={() => void submit()}>{busy ? ja ? "送信中…" : "Submitting…" : ja ? "非公開で送る" : "Submit privately"}</button></div><p aria-live="polite" role="status">{message}</p><small>{ja ? "送信は回答・掲載を保証するものではありません。掲載時は質問者を特定できる情報を表示しません。" : "Submission does not guarantee an answer or publication. Published answers will not identify the submitter."}</small></section>
      <section className={styles.card}><h2>{ja ? "送った質問" : "Your questions"}</h2>{items.length === 0 ? <p>{ja ? "まだ質問はありません。" : "No questions yet."}</p> : <div className={styles.history}>{items.map(item => <article key={item.id}><div><strong>{labels[item.status][lang]}</strong><time>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(item.createdAt))}</time></div><p>{item.body}</p>{item.status === "answered" && <Link href={`/research/qa/answered#${item.answerPostId}`}>{ja ? "公開回答を見る" : "View published answer"}</Link>}</article>)}</div>}</section></>}
  </ResearchToolShell>;
}
