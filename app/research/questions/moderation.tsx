"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../editorial/styles.module.css";
import questionStyles from "./styles.module.css";

type Question = { id: string; body: string; status: "pending" | "answered" | "closed"; answerPostId: string | null; createdAt: string; audience: "private" | "pro-board" };
type Answer = { id: string; titleJa: string; publishedAt: string };
type View = "pending" | "answered" | "closed" | "all";
const statusLabel = { pending: "未対応", answered: "回答を紐づけ済み", closed: "今回は掲載なし" };

export default function Moderation() {
  const [items, setItems] = useState<Question[]>([]); const [answers, setAnswers] = useState<Answer[]>([]);
  const [counts, setCounts] = useState({ pending: 0, answered: 0, closed: 0 }); const [view, setView] = useState<View>("pending");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("運営者アカウントを確認中…");
  async function load(next: View = view) { setBusy(true); try { const response = await fetch(`/api/research/questions/moderation?view=${next}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }); const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error); setItems(data.items); setAnswers(data.answers); setCounts(data.counts); setView(next); setMessage(data.items.length ? "質問本文を確認し、公開済みQ&Aとの対応だけを記録してください。" : "この表示に質問はありません。"); } catch (error) { setMessage((error as Error).message === "owner-required" ? "運営者アカウントでログインしてください。" : "質問受信箱に接続できませんでした。"); } finally { setBusy(false); } }
  useEffect(() => { void load("pending"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function decide(item: Question, decision: "pending" | "answered" | "closed", answerPostId?: string) { setBusy(true); setMessage("保存しています…"); try { const response = await fetch("/api/research/questions/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, decision, answerPostId }), signal: AbortSignal.timeout(15_000) }); const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error); await load(view); setMessage(decision === "answered" ? "公開済みQ&Aを回答として紐づけました。" : decision === "closed" ? "削除・非表示にする状態にしました。" : "未対応へ戻しました。"); } catch { setMessage("保存できませんでした。状態は変更していません。"); setBusy(false); } }
  return <main className={`${styles.main} ${questionStyles.main}`}><header><p>TECH PHASE · QUESTION MODERATION</p><h1>質問受信箱</h1><Link href="/research/editorial">Q&Aの回答を書く</Link> · <Link href="/research/qa/answered">公開回答を見る</Link></header><aside className={questionStyles.warning}><strong>PRO掲示板・以前の非公開質問</strong><span>新しい投稿はPRO会員内で共有されます。「削除・非表示にする」で掲示板から除外できます。以前の非公開質問は公開しません。質問者の識別情報は表示しません。本文をそのまま公開せず、個人情報を除き、根拠を確認したQ&A記事として編集してください。すべての質問に回答する必要はありません。</span></aside><p role="status" aria-live="polite">{message}</p><nav className={questionStyles.filters} aria-label="質問の状態">{(["pending", "answered", "closed", "all"] as View[]).map(value => <button key={value} disabled={busy} aria-pressed={view === value} onClick={() => void load(value)}>{value === "all" ? `すべて ${counts.pending + counts.answered + counts.closed}` : `${statusLabel[value]} ${counts[value]}`}</button>)}</nav><section className={questionStyles.list} aria-busy={busy}>{items.map(item => <QuestionRow key={item.id} item={item} answers={answers} busy={busy} decide={decide} />)}</section></main>;
}

function QuestionRow({ item, answers, busy, decide }: { item: Question; answers: Answer[]; busy: boolean; decide: (item: Question, decision: "pending" | "answered" | "closed", answerPostId?: string) => Promise<void> }) {
  const [answer, setAnswer] = useState(item.answerPostId ?? "");
  return <article><div className={questionStyles.meta}><strong>{statusLabel[item.status]}</strong><time>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(item.createdAt))}</time></div><p>{item.audience === "pro-board" ? "【PRO掲示板】" : "【非公開】"}{item.body}</p><label>公開済みQ&A<select value={answer} onChange={event => setAnswer(event.target.value)}><option value="">選択してください</option>{answers.map(value => <option value={value.id} key={value.id}>{value.titleJa || value.id}</option>)}</select></label><div className={questionStyles.actions}><button disabled={busy || !answer} onClick={() => void decide(item, "answered", answer)}>選んだ回答を紐づける</button><button disabled={busy} onClick={() => void decide(item, "closed")}>削除・非表示にする</button>{item.status !== "pending" && <button disabled={busy} onClick={() => void decide(item, "pending")}>未対応へ戻す</button>}</div></article>;
}
