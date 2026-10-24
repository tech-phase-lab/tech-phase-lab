"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { useUser } from "@clerk/nextjs";
import type { EditorialPost } from "@/lib/research/editorial-posts";
import styles from "../editorial/styles.module.css";
import noteStyles from "./styles.module.css";
type Note = { id: string; version: number; bodyJa: string; status: string };
const empty = (): Note => ({ id: crypto.randomUUID(), version: 0, bodyJa: "", status: "draft" });
const excerpt = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 34) || "本文なし";
const errors: Record<string, string> = { "owner-required": "運営者アカウントでログインしてください。", "setup-required": "投稿機能の接続設定がまだ完了していません。", "post-conflict": "別の操作で更新されています。入力を控えてから、最新版を読み込んでください。" };
function WriterContent() {
  const { isSignedIn, isLoaded } = useUser();
  const [items, setItems] = useState<EditorialPost[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [saved, setSaved] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("運営者アカウントを確認中…");
  const [offset, setOffset] = useState<number | null>(null);
  const dirty = !!note && JSON.stringify(note) !== saved;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/author", { cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error); return data; }).then(data => { setItems(data.items); setOffset(data.nextOffset); setReady(true); const initial = empty(); setNote(initial); setSaved(JSON.stringify(initial)); setMessage(""); }).catch(e => { if (e.name !== "AbortError") setMessage(errors[e.message] || "接続できませんでした。再読み込みしてください。"); });
    return () => controller.abort();
  }, [isSignedIn]);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function select(value: Note) { const selected = { id: value.id, version: value.version, bodyJa: value.bodyJa, status: value.status }; setNote(selected); setSaved(JSON.stringify(selected)); }
  async function write(action: string) {
    if (!note) return; setBusy(true); setPending(action); setMessage(action === "publish" ? "公開しています…このままお待ちください。" : action === "withdraw" ? "公開を取り下げています…" : "保存しています…このままお待ちください。");
    try {
      const r = await fetch("/api/research/author", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...note, action }), signal: AbortSignal.timeout(45_000) }); const data = await r.json();
      if (data.item) { select(data.item); setItems(current => [data.item, ...current.filter(v => v.id !== data.item.id)]); }
      if (!r.ok || !data.ok) throw Error(data.error);
      setMessage(action === "publish" ? "日本語版を公開しました。英語版は翻訳待ちです。" : action === "withdraw" ? "公開を取り下げました。" : "下書きを保存しました。");
    } catch (e) { setMessage(errors[(e as Error).message] || "処理を完了できませんでした。入力を残しています。公開に失敗した場合も、下書きは保存されていることがあります。"); }
    finally { setBusy(false); setPending(""); }
  }
  async function more() {
    setBusy(true); try { const r = await fetch(`/api/research/author?offset=${offset}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) }); const d = await r.json(); if (!r.ok || !d.ok) throw Error(); setItems(v => [...v, ...d.items.filter((item: EditorialPost) => !v.some(x => x.id === item.id))]); setOffset(d.nextOffset); } catch { setMessage("以前の投稿を読み込めませんでした。"); } finally { setBusy(false); }
  }
  return <main className={`${styles.main} ${noteStyles.main}`}><header><Link href="/research">Tech Phaseへ戻る</Link><h1>ひとりごとを書く</h1></header>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {!ready && isLoaded && !isSignedIn && <SignIn routing="hash" signUpUrl="/research/account/sign-up" forceRedirectUrl="/research/write" />}{!ready && isLoaded && isSignedIn && <p><Link href="/research/account">アカウントを確認</Link></p>}
    {ready && note && <div className={`${styles.layout} ${noteStyles.layout}`} aria-busy={busy}><section className={styles.editor}><div className={styles.saveBar}><div><strong>{pending === "publish" ? "公開中…" : pending === "draft" ? "保存中…" : pending === "withdraw" ? "取り下げ中…" : note.status === "published" ? "公開中" : "下書き"}</strong><span>{pending ? "完了までこの画面を閉じないでください" : dirty ? "未保存の変更があります" : note.version ? "保存済み" : "新しい投稿"}</span></div><button disabled={busy || !dirty} onClick={() => void write("draft")}>{pending === "draft" ? "保存中…" : "下書き保存"}</button></div>
        <fieldset disabled={busy}><label>本文<textarea autoFocus className={`${styles.body} ${noteStyles.body}`} value={note.bodyJa} maxLength={6000}  onChange={e => setNote({ ...note, bodyJa: e.target.value })} /><small className={styles.counter}>{note.bodyJa.length.toLocaleString()} / 6,000文字</small></label></fieldset>
        <p className={noteStyles.hint}>英語版は自動で作成されます。</p>
        {note.status === "published" && <p>下書き保存すると一度非公開になります。修正内容をすぐ反映する場合は「更新する」を押してください。</p>}
        <div className={`${styles.actions} ${noteStyles.publishBar}`}><button disabled={busy || !note.bodyJa.trim() || (note.status === "published" && !dirty)} onClick={() => void write("publish")}>{pending === "publish" ? "公開中…" : note.status === "published" ? "更新する" : "投稿する"}</button>{note.status === "published" && <button disabled={busy || dirty} onClick={() => void write("withdraw")}>{pending === "withdraw" ? "取り下げ中…" : "公開を取り下げる"}</button>}{dirty && <button disabled={busy} onClick={() => { if (saved) setNote(JSON.parse(saved)); else { const value = empty(); setNote(value); setSaved(JSON.stringify(value)); } }}>未保存の変更を破棄</button>}</div>
      </section><details className={noteStyles.history}><summary>過去の投稿・下書き（{items.length}件）</summary><nav aria-label="これまでの投稿"><button disabled={busy || dirty} onClick={() => { const value = empty(); setNote(value); setSaved(JSON.stringify(value)); }}>新しく書く</button>{items.map(item => <button key={item.id} disabled={busy || dirty} onClick={() => select(item)}>{excerpt(item.bodyJa)}<small>{item.status === "published" ? "公開中" : "非公開"}</small></button>)}{offset !== null && <button disabled={busy} onClick={() => void more()}>以前の投稿</button>}</nav></details></div>}
  </main>;
}

export default function Writer() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return <main className={styles.main}><h1>ひとりごとを書く</h1><p>投稿画面に接続できませんでした。</p><Link href="/research">ホームへ戻る</Link></main>;
  return <WriterContent />;
}
