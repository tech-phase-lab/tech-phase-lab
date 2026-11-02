"use client";
import { useIdentityRefresh } from "../identity-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { EditorialPost } from "@/lib/research/editorial-posts";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useOwnerMode } from "../member-display-provider";
import styles from "./styles.module.css";

type Question = { id: string; body: string; bodyEn?: string; status: "pending" | "answered" | "closed"; answerPostId: string | null; createdAt: string; isMine?: boolean; answer?: EditorialPost; held?: boolean; heldReason?: string };
const nextId = () => `q-${crypto.randomUUID().replaceAll("-", "")}`;
type QuestionState = "loading" | "ready" | "signed-out" | "pro-required" | "error";
const MIN = 10, MAX = 1200;

const when = (iso: string, ja: boolean, short = false) => {
  const parts = new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { ...(short ? {} : { year: "numeric" }), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return short ? `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}` : `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
};
const icons = {
  pen: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.800 2.800 0 0 0-4-4L4 15z" /></svg>,
  trash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg>,
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg>,
};

export default function Questions() {
  const refreshIdentity = useIdentityRefresh();
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const ownerMode = useOwnerMode();
  const [items, setItems] = useState<Question[]>([]);
  const [pages, setPages] = useState(1), [hasNext, setHasNext] = useState(false), [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState<number | null>(null), [left, setLeft] = useState<number | null>(null);
  const [state, setState] = useState<QuestionState>("loading");
  const [open, setOpen] = useState(false), [body, setBody] = useState(""), [requestId, setRequestId] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const reload = () => setRevision(value => value + 1);

  useEffect(() => {
    setRequestId(nextId());
    let active = true;
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort(); controller = new AbortController();
      const current = controller;
      try {
        await refreshIdentity();
        const responses = await Promise.all(Array.from({ length: pages }, (_, index) => fetch(`/api/research/questions?page=${index + 1}`, { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(10_000)]) })));
        if (!active || current.signal.aborted) return;
        const denied = responses.find(response => response.status === 401 || response.status === 403);
        if (denied) { setItems([]); setState(denied.status === 401 ? "signed-out" : "pro-required"); return; }
        const data = await Promise.all(responses.map(response => response.json()));
        if (!active || current.signal.aborted) return;
        if (responses.some(response => !response.ok) || data.some(page => !page.ok || page.audience !== "pro-board" || !Array.isArray(page.items))) throw Error();
        setItems(data.flatMap(page => page.items)); setHasNext(data.at(-1).hasNext === true);
        setLimit(Number.isInteger(data[0].limit) ? data[0].limit : null); setLeft(Number.isInteger(data[0].left) ? data[0].left : null);
        setState("ready");
      } catch (error) { if (active && !(error instanceof Error && error.name === "AbortError")) { setItems([]); setState("error"); } }
    }
    void refresh(); const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refreshIdentity, pages, revision]);

  // A link to a question (…#q-…) scrolls to it once the list has arrived.
  useEffect(() => {
    if (state !== "ready" || !window.location.hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [state, items.length]);

  async function submit() {
    if (state !== "ready" || body.trim().length < MIN || !requestId || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/research/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, body, audience: "pro-board" }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { setItems([]); setState(response.status === 401 ? "signed-out" : "pro-required"); return; }
      if (!response.ok || !data.ok || !data.item) throw Error(data.error || "failed");
      if (Number.isInteger(data.left)) setLeft(data.left);
      setPages(1); reload(); setBody(""); setOpen(false); setRequestId(nextId());
      setMessage(ja ? "投稿しました。" : "Posted.");
    } catch (error) {
      setMessage(error instanceof Error && error.message === "question-daily-limit" ? (ja ? "今日の投稿は、上限に達しました。" : "You have reached today’s limit.") : ja ? "送信を完了できませんでした。入力は残っています。通信を確認して、もう一度お試しください。" : "Submission did not complete. Your text is still here; check the connection and try again.");
    } finally { setBusy(false); }
  }

  const description = ownerMode
    ? (ja ? "集まった質問です。回答する質問を選べます。" : "The questions that came in. Choose which to answer.")
    : (ja ? "PRO会員の質問から、リゼルが選んで回答します。すべてには答えられません。" : "RIZEL picks questions from PRO members to answer. Not every question can be answered.");
  const rules = [
    ja ? "質問は、PRO会員全員に公開されます。" : "Questions are visible to all PRO members.",
    ja ? "リゼルが選んだ質問にだけ、回答します。" : "RIZEL answers only the questions chosen.",
    ja ? `1日${limit ?? 2}件まで(日本時間の0時で切り替わります)。消しても、その日の残り件数は戻りません。` : `Up to ${limit ?? 2} a day (resets at 0:00 Japan time). Deleting a post does not give it back.`,
  ];
  return <ResearchToolShell desk lang={lang} setLang={setLang} title={ja ? "リゼルに聞く" : "Ask Rizel"} description={description}>
    {(state === "signed-out" || state === "pro-required") && <section className={styles.askNotice}><h2>{ja ? "閲覧・投稿はPRO会員限定です" : "PRO membership required"}</h2><p>{ja ? "PRO会員になると質問の投稿と閲覧ができます。すべての質問への回答はお約束していません。" : "PRO members can post and read questions. Not every question will receive an answer."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></section>}
    {state === "error" && <p role="status">{ja ? "質問機能に接続できませんでした。時間をおいて再読み込みしてください。" : "Questions are temporarily unavailable. Please reload later."}</p>}
    {(state === "ready" || state === "loading") && <>
      {!ownerMode && (open
        ? <section className={styles.askPanel} aria-busy={busy} aria-label={ja ? "リゼルに質問する" : "Ask Rizel"}>
          <header><h2>{ja ? "リゼルに質問する" : "Ask Rizel"}</h2><button type="button" className={styles.askClose} aria-label={ja ? "閉じる" : "Close"} disabled={busy} onClick={() => setOpen(false)}>×</button></header>
          <textarea autoFocus maxLength={MAX} value={body} aria-label={ja ? "質問" : "Question"} onChange={event => setBody(event.target.value)} />
          <p className={styles.askChips}><span>{ja ? "全員に公開" : "Public to members"}</span><span>{ja ? "個人情報は書かない" : "No personal information"}</span>{left !== null && <span>{ja ? `今日あと ${left} 件` : `${left} left today`}</span>}</p>
          <div className={styles.askFoot}><span className={styles.askCount}>{body.length.toLocaleString()} / {MAX.toLocaleString()}<small>{ja ? `${MIN}文字から` : `${MIN}+ characters`}</small></span>
            <button type="button" className={styles.askSend} disabled={state !== "ready" || busy || body.trim().length < MIN || left === 0} onClick={() => void submit()}>{busy ? (ja ? "送信中…" : "Posting…") : ja ? "投稿" : "Post"}</button></div>
          <details className={styles.askRules}><summary>{ja ? "回答と投稿について" : "About answers and posting"}</summary>{rules.map(text => <p key={text}>{text}</p>)}</details>
        </section>
        : <button type="button" className={styles.askBar} disabled={state !== "ready" || left === 0} onClick={() => { setMessage(""); setOpen(true); }}>
          <span className={styles.askBarIcon}>{icons.pen}</span><b>{ja ? "リゼルに質問する" : "Ask Rizel"}</b>
          {left !== null && <small>{left === 0 ? (ja ? "今日は終わりました" : "Done for today") : ja ? `今日あと ${left} 件` : `${left} left today`}</small>}
        </button>)}
      {message && <p className={styles.askMessage} role="status" aria-live="polite">{message}</p>}
      {items.length === 0 && <p className={styles.askEmpty}>{state === "loading" ? (ja ? "読み込み中…" : "Loading…") : ja ? "まだ質問はありません。" : "No questions yet."}</p>}
      <div className={styles.askList}>{items.map(item => <QuestionCard key={item.id} item={item} ja={ja} ownerMode={ownerMode} onChanged={reload} />)}</div>
      {hasNext && <button type="button" className={styles.askMore} onClick={() => setPages(value => value + 1)}>{ja ? "さらに表示する" : "Show more"}</button>}
    </>}
  </ResearchToolShell>;
}

function QuestionCard({ item, ja, ownerMode, onChanged }: { item: Question; ja: boolean; ownerMode: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const held = ownerMode && item.held === true;
  const tag = held ? { className: styles.tagHeld, label: ja ? "保留" : "Held", icon: null } : item.status === "answered" ? { className: styles.tagDone, label: ja ? "回答済み" : "Answered", icon: icons.check } : { className: styles.tagOpen, label: ja ? "受付中" : "Open", icon: <i aria-hidden="true" /> };
  async function call(url: string, payload: object, failure: string) {
    if (busy) return false;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      onChanged(); return true;
    } catch { setMessage(failure); return false; } finally { setBusy(false); }
  }
  const remove = () => {
    if (!window.confirm(ja ? "この質問を削除しますか？" + (ownerMode ? "" : "\n消しても、今日の残り件数は戻りません。") : "Delete this question?")) return;
    void (ownerMode ? call("/api/research/questions/moderation", { id: item.id, decision: "delete" }, ja ? "削除できませんでした。" : "Could not delete.") : call("/api/research/questions", { action: "delete", id: item.id }, ja ? "削除できませんでした。" : "Could not delete."));
  };
  const publish = async () => {
    if (!text.trim()) return;
    const answering = item.status === "answered" && item.answer;
    const ok = await call("/api/research/questions/moderation", answering ? { id: item.id, decision: "edit-reply", body: text, expectedVersion: item.answer!.version } : { id: item.id, decision: "reply", body: text }, ja ? "公開できませんでした。入力は残っています。" : "Could not publish. Your text is still here.");
    if (ok) setEditing(false);
  };
  return <article className={styles.q} id={item.id}>
    <header><time dateTime={item.createdAt}>{when(item.createdAt, ja)}</time><span className={`${styles.tag} ${tag.className}`}>{tag.icon}{tag.label}</span></header>
    <p className={styles.qText}>{ja ? item.body : item.bodyEn || "Translation in progress…"}</p>
    {item.status === "answered" && item.answer && !editing && <div className={styles.a}>
      <header><Image src="/rizel-avatar.webp" alt="" width={34} height={34} unoptimized /><b>{ja ? "リゼルの回答" : "RIZEL’s answer"}</b><time dateTime={item.answer.publishedAt!}>{when(item.answer.publishedAt!, ja, true)}</time></header>
      <p>{ja ? item.answer.bodyJa : item.answer.bodyEn || "Translation pending."}</p>
    </div>}
    {editing && <div className={styles.aEdit}>
      <textarea autoFocus maxLength={6000} value={text} aria-label={ja ? "回答" : "Answer"} onChange={event => setText(event.target.value)} />
      <div><button type="button" className={styles.btnGold} disabled={busy || !text.trim()} onClick={() => void publish()}>{busy ? (ja ? "公開中…" : "Publishing…") : ja ? "回答を公開" : "Publish"}</button><button type="button" className={styles.btnLine} disabled={busy} onClick={() => setEditing(false)}>{ja ? "閉じる" : "Close"}</button></div>
    </div>}
    {message && <p className={styles.askMessage} role="status">{message}</p>}
    <footer>
      {ownerMode ? <>
        {held && <><button type="button" className={styles.btnLine} disabled={busy} onClick={() => void call("/api/research/questions/moderation", { id: item.id, decision: "release" }, ja ? "表示できませんでした。" : "Could not show it.")}>{ja ? "表示する" : "Show"}</button><small>{item.heldReason}</small></>}
        {!held && item.status === "pending" && !editing && <button type="button" className={styles.btnGold} onClick={() => { setText(""); setEditing(true); }}>{ja ? "回答する" : "Answer"}</button>}
        {!held && item.status === "answered" && item.answer && !editing && <button type="button" className={styles.btnLine} onClick={() => { setText(item.answer!.bodyJa); setEditing(true); }}>{icons.pen}{ja ? "回答を編集" : "Edit answer"}</button>}
      </> : item.isMine && <small>{ja ? "あなたの質問" : "Your question"}</small>}
      {(ownerMode || item.isMine) && <button type="button" className={styles.trash} aria-label={ja ? "この質問を削除" : "Delete this question"} disabled={busy} onClick={remove}>{icons.trash}</button>}
    </footer>
  </article>;
}
