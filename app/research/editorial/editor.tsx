"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { postNames, type EditorialPost, type PostKind } from "@/lib/research/editorial-posts";
import styles from "./styles.module.css";
const blank = (): EditorialPost => ({ id: crypto.randomUUID(), version: 0, kind: "weekly", status: "draft", titleJa: "", titleEn: "", introJa: "", introEn: "", bodyJa: "", bodyEn: "", sourceNotes: "", sources: [], updatedAt: "", publishedAt: null });
const statusNames = { draft: "下書き", published: "公開中", withdrawn: "取り下げ" };
const errors: Record<string, string> = {
  "post-conflict": "別の操作で更新されています。入力を控えたうえで一覧を再読み込みし、最新版を開いてください。",
  "post-bilingual-required": "公開には日英両方の見出し・導入文・本文（20文字以上）が必要です。",
  "post-sources-required": "根拠・元メモが必要です。週刊とQ&Aには出典も追加してください。",
  "invalid-post-sources": "出典の名前とHTTPSのURLを確認してください。",
  unauthorized: "編集用トークンを確認してください。",
};
export default function EditorialEditor() {
  const [token, setToken] = useState("");
  return <main className={styles.main}>
    <header><p>TECH PHASE · PRIVATE EDITOR</p><h1>週刊・Q&A・リゼルノート</h1><Link href="/research/review">速報レビューへ</Link> · <Link href="/research/columns">会員向けページへ</Link></header>
    <label className={styles.auth}>編集用トークン<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
    <p>トークンはこの画面のメモリだけで保持します。トークン変更時は未保存の入力が消えます。本文はプレーンテキストで表示します。</p>
    <Workspace key={token} token={token} />
  </main>;
}
function Workspace({ token }: { token: string }) {
  const [items, setItems] = useState<EditorialPost[]>([]);
  const [draft, setDraft] = useState<EditorialPost | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("編集用トークンを入力して一覧を読み込んでください。");
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [verified, setVerified] = useState(false);
  const [preview, setPreview] = useState<"ja" | "en">("ja");
  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function request(action?: string, payload?: unknown, offset = 0) {
    const response = await fetch(`/api/research/editor?kind=posts&offset=${offset}`, {
      method: action ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
      ...(action ? { body: JSON.stringify({ action, payload }) } : {}), signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "unavailable");
    return data;
  }
  function select(value: EditorialPost) { setDraft(value); setSaved(JSON.stringify(value)); setVerified(false); setReason(""); }
  async function load(more = false) {
    setBusy(true);
    try { const data = await request(undefined, undefined, more ? nextOffset ?? 0 : 0); setItems(current => more ? [...current, ...data.items.filter((item: EditorialPost) => !current.some(v => v.id === item.id))] : data.items); setNextOffset(data.nextOffset); setMessage("一覧を読み込みました。編集中の入力はそのままです。"); }
    catch (e) { setMessage(errors[(e as Error).message] || "読み込めませんでした。接続とトークンを確認してください。"); }
    finally { setBusy(false); }
  }
  function edit<K extends keyof EditorialPost>(key: K, value: EditorialPost[K]) {
    if (draft) setDraft({ ...draft, [key]: value }); setVerified(false);
  }
  async function write(decision?: "published" | "withdrawn") {
    if (!draft) return;
    setBusy(true);
    try {
      const data = await request(decision ? "post-review" : "post-draft", decision ? { id: draft.id, version: draft.version, decision, reviewer, reason, verified } : draft);
      select(data.item); setItems(current => [data.item, ...current.filter(item => item.id !== data.item.id)] );
      setMessage(decision === "published" ? "公開しました。本文はPRO会員だけに表示されます。" : decision === "withdrawn" ? "取り下げました。会員向け一覧から非表示になります。" : "下書きを保存しました。まだ公開されません。");
    } catch (e) { setMessage(errors[(e as Error).message] || "保存できませんでした。入力は残しています。容量と接続を確認してください。"); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.actions}><button disabled={busy || token.length < 24} onClick={() => void load()}>一覧を読み込む</button><button disabled={busy || dirty || token.length < 24} onClick={() => { const value = blank(); setDraft(value); setSaved(""); setVerified(false); setReason(""); }}>新規記事</button></div>
    <p role="status">{message}</p>
    <div className={styles.layout}><nav aria-label="保存済み記事">{items.map(item => <button disabled={busy || dirty} key={item.id} aria-current={draft?.id === item.id} onClick={() => select(item)}>{item.titleJa || "無題"}<small>{postNames[item.kind].ja} · {statusNames[item.status]}</small></button>)}{nextOffset !== null && <button disabled={busy} onClick={() => void load(true)}>以前の記事を読み込む</button>}</nav>
    {draft && <section className={styles.editor}>
      <p>{statusNames[draft.status]} · 保存版 {draft.version}{dirty ? " · 未保存" : ""}</p>
      {dirty && <button disabled={busy} onClick={() => { if (saved) select(JSON.parse(saved)); else { setDraft(null); setSaved(""); } }}>未保存の変更を破棄</button>}
      <fieldset disabled={busy}>
      <label>記事の種類<select value={draft.kind} onChange={e => edit("kind", e.target.value as PostKind)}>{Object.entries(postNames).map(([key, value]) => <option value={key} key={key}>{value.ja}</option>)}</select></label>
      <p>{draft.kind === "weekly" ? "重要な変化・見方の修正・来週の確認点をまとめます。" : draft.kind === "qa" ? "選んだ質問と回答を掲載します。質問者の名前や個人情報は載せず、すべての質問への回答は約束しません。" : "ご本人の実際のメモ・発言を元に編集します。意見や売買を創作しません。"}</p>
      <div className={styles.languages}>{(["Ja", "En"] as const).map(lang => <div key={lang}><h2>{lang === "Ja" ? "日本語" : "English"}</h2>
        <label>見出し<input maxLength={180} value={draft[`title${lang}`]} onChange={e => edit(`title${lang}`, e.target.value)} /></label>
        <label>無料で表示する導入文<textarea maxLength={500} value={draft[`intro${lang}`]} onChange={e => edit(`intro${lang}`, e.target.value)} /></label>
        <label>PRO本文<textarea className={styles.body} maxLength={6000} value={draft[`body${lang}`]} onChange={e => edit(`body${lang}`, e.target.value)} /></label>
      </div>)}</div>
      <label>根拠・元メモ（非公開）<textarea maxLength={4000} value={draft.sourceNotes || ""} onChange={e => edit("sourceNotes", e.target.value)} /></label>
      <h2>出典（PRO本文と一緒に表示）</h2>
      {draft.sources.map((source, index) => <div className={styles.source} key={index}>
        <input aria-label={`出典${index + 1}の名前`} maxLength={180} value={source.title} onChange={e => edit("sources", draft.sources.map((v, i) => i === index ? { ...v, title: e.target.value } : v))} />
        <input aria-label={`出典${index + 1}のURL`} placeholder="https://" maxLength={1000} value={source.url} onChange={e => edit("sources", draft.sources.map((v, i) => i === index ? { ...v, url: e.target.value } : v))} />
        <button onClick={() => edit("sources", draft.sources.filter((_, i) => i !== index))}>削除</button>
      </div>)}
      <button disabled={draft.sources.length >= 8} onClick={() => edit("sources", [...draft.sources, { title: "", url: "" }])}>出典を追加</button>
      </fieldset>
      <p>公開中の記事を下書き保存すると、再公開まで会員向け一覧から非表示になります。</p>
      <button disabled={busy || !dirty} onClick={() => void write()}>下書きを保存</button>
      <section className={styles.review}><h2>公開確認</h2><label>確認者<input value={reviewer} maxLength={120} onChange={e => setReviewer(e.target.value)} /></label><label>確認・取り下げの理由<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />日英の意味・数字・出典・本人の見解・個人情報を確認しました</label>
      <div className={styles.actions}><button disabled={busy || dirty || !draft.version || !verified || reviewer.trim().length < 2 || reason.trim().length < 5 || draft.status === "published"} onClick={() => void write("published")}>PRO記事として公開</button><button disabled={busy || dirty || draft.status !== "published" || reviewer.trim().length < 2 || reason.trim().length < 5} onClick={() => void write("withdrawn")}>公開を取り下げる</button></div></section>
      <section className={styles.preview}><h2>表示プレビュー（未保存の入力を含む）</h2><select aria-label="プレビュー言語" value={preview} onChange={e => setPreview(e.target.value as "ja" | "en")}><option value="ja">日本語</option><option value="en">English</option></select><p>{postNames[draft.kind][preview]}</p><h3>{preview === "ja" ? draft.titleJa : draft.titleEn}</h3><p>{preview === "ja" ? draft.introJa : draft.introEn}</p><hr /><p className={styles.text}>{preview === "ja" ? draft.bodyJa : draft.bodyEn}</p></section>
    </section>}</div>
  </>;
}
