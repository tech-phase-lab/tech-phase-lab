"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";

type Question = { id: string; body: string; status: "pending" | "answered" | "closed"; answerPostId: string | null; createdAt: string; isMine?: boolean };
const nextId = () => `q-${crypto.randomUUID().replaceAll("-", "")}`;
const labels = { pending: { ja: "受付済み", en: "Received" }, answered: { ja: "回答を公開", en: "Answered" }, closed: { ja: "今回は掲載なし", en: "Not selected" } } as const;

export default function Questions() {
  const [lang, setLang] = useResearchLanguage();
  const [items, setItems] = useState<Question[]>([]);
  const [privateItems, setPrivateItems] = useState<Question[]>([]);
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "pro-required" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ja = lang === "ja";
  useEffect(() => {
    setRequestId(nextId());
    let active = true;
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort(); controller = new AbortController();
      const current = controller;
      try {
        const response = await fetch("/api/research/questions", { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(10_000)]) });
        const data = await response.json();
        if (!active || current.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setItems([]); setPrivateItems([]); setState(response.status === 401 ? "signed-out" : "pro-required"); return; }
        if (!response.ok || !data.ok || data.audience !== "pro-board" || !Array.isArray(data.items)) throw Error();
        setItems(data.items); setPrivateItems(data.privateItems || []); setState("ready");
      } catch (error) { if (active && !(error instanceof Error && error.name === "AbortError")) { setItems([]); setPrivateItems([]); setState("error"); } }
    }
    void refresh(); const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  async function submit() {
    if (body.trim().length < 10 || !requestId) return;
    setBusy(true); setMessage(ja ? "送信しています…" : "Submitting…");
    try {
      const response = await fetch("/api/research/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, body, audience: "pro-board" }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { setItems([]); setPrivateItems([]); setState(response.status === 401 ? "signed-out" : "pro-required"); }
      if (!response.ok || !data.ok || !data.item) throw Error(data.error || "failed");
      setItems(current => [{ ...data.item, isMine: true }, ...current.filter(item => item.id !== data.item.id)].slice(0, 50)); setBody(""); setRequestId(nextId());
      setMessage(ja ? "PRO会員向け掲示板に投稿しました。" : "Posted to the PRO member board.");
    } catch { setMessage(ja ? "送信を完了できませんでした。入力は残っています。通信を確認して、もう一度お試しください。" : "Submission did not complete. Your text is still here; check the connection and try again."); }
    finally { setBusy(false); }
  }
  return <ResearchToolShell desk lang={lang} setLang={setLang} title={ja ? "リゼルに聞く" : "Ask RIZEL"} description={ja ? "PRO会員の質問をみんなで読み、リゼルが選んだテーマに回答するコーナーです。" : "A shared question board for PRO members. RIZEL picks topics to answer."}>
    <nav className={styles.views} aria-label={ja ? "質問メニュー" : "Question views"}><span aria-current="page">{ja ? "質問掲示板" : "Question board"}</span><Link href="/research/qa/answered">{ja ? "公開された回答" : "Published answers"}</Link></nav>
    {state === "loading" && <p role="status">{ja ? "会員情報を確認中…" : "Checking your account…"}</p>}
    {(state === "signed-out" || state === "pro-required") && <section className={styles.card}><h2>{ja ? "閲覧・投稿はPRO会員限定です" : "PRO membership required"}</h2><p>{ja ? "PRO会員になると質問の投稿と閲覧ができます。すべての質問への回答はお約束していません。" : "PRO members can post and read questions. Not every question will receive an answer."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></section>}
    {state === "error" && <p role="status">{ja ? "質問機能に接続できませんでした。時間をおいて再読み込みしてください。" : "Questions are temporarily unavailable. Please reload later."}</p>}
    {state === "ready" && <><section className={styles.card} aria-busy={busy}><h2>{ja ? "質問を書く" : "Write your question"}</h2><p>{ja ? "投稿内容はPRO会員全員に公開されます。1日10件まで、10〜1,200文字。個人情報、口座番号、連絡先は書かないでください。内容を確認してから送信します。" : "Your post will be visible to all PRO members. Up to 10 posts a day, 10–1,200 characters. Do not include personal details, account numbers, or contact information. Review before submitting."}</p><label>{ja ? "質問" : "Question"}<textarea autoFocus maxLength={1200} value={body} onChange={event => setBody(event.target.value)} placeholder={ja ? "例：決算で、売上高より先に確認したい数字は？" : "Example: Which earnings metric should I check before revenue?"} /></label><div className={styles.submit}><small>{body.length.toLocaleString()} / 1,200</small><button disabled={busy || body.trim().length < 10} onClick={() => void submit()}>{busy ? ja ? "送信中…" : "Submitting…" : ja ? "PRO会員に公開して投稿" : "Post to PRO board"}</button></div><p aria-live="polite" role="status">{message}</p><small>{ja ? "すべての質問への回答はお約束していません。不適切な投稿は削除します。悪質な投稿が増えた場合、掲示板を休止・閉鎖することがあります。" : "Answers are not guaranteed. Inappropriate posts will be removed. Repeated abuse may result in the board being suspended or closed."}</small></section>
      <section className={styles.card}><h2>{ja ? "みんなの質問（最新50件）" : "Latest 50 questions"}</h2>{items.length === 0 ? <p>{ja ? "まだ質問はありません。" : "No questions yet."}</p> : <div className={styles.history}>{items.map(item => <article key={item.id}><div><strong>{item.isMine ? ja ? "あなたの投稿 · " : "Your post · " : ""}{labels[item.status][lang]}</strong><time>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(item.createdAt))}</time></div><p>{item.body}</p>{item.status === "answered" && <Link href={`/research/qa/answered#${item.answerPostId}`}>{ja ? "公開回答を見る" : "View published answer"}</Link>}</article>)}</div>}</section>{privateItems.length > 0 && <details className={styles.card}><summary>{ja ? "以前の非公開質問（本人と運営者のみ）" : "Previous private questions (you and the editor only)"}</summary>{privateItems.map(item => <article key={item.id}><p>{item.body}</p></article>)}</details>}</>}
  </ResearchToolShell>;
}
