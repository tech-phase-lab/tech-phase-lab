"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { EditorialPost } from "@/lib/research/editorial-posts";
import styles from "../editorial/styles.module.css";
type Note = { id: string; version: number; titleJa: string; bodyJa: string; status: string };
const empty = (): Note => ({ id: crypto.randomUUID(), version: 0, titleJa: "", bodyJa: "", status: "draft" });
const errors: Record<string, string> = { "owner-required": "運営者アカウントでログインしてください。", "setup-required": "投稿機能の接続設定がまだ完了していません。", "post-conflict": "別の操作で更新されています。入力を控えてから、最新版を読み込んでください。" };
export default function Writer() {
  const [items, setItems] = useState<EditorialPost[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [saved, setSaved] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("運営者アカウントを確認中…");
  const [offset, setOffset] = useState<number | null>(null);
  const dirty = !!note && JSON.stringify(note) !== saved;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/author", { cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error); return data; }).then(data => { setItems(data.items); setOffset(data.nextOffset); setReady(true); const initial = empty(); setNote(initial); setSaved(JSON.stringify(initial)); setMessage("日本語で気軽に書いてください。"); }).catch(e => { if (e.name !== "AbortError") setMessage(errors[e.message] || "接続できませんでした。再読み込みしてください。"); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function select(value: Note) { const selected = { id: value.id, version: value.version, titleJa: value.titleJa, bodyJa: value.bodyJa, status: value.status }; setNote(selected); setSaved(JSON.stringify(selected)); }
  async function write(action: string) {
    if (!note) return; setBusy(true);
    try {
      const r = await fetch("/api/research/author", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...note, action }), signal: AbortSignal.timeout(45_000) }); const data = await r.json();
      if (data.item) { select(data.item); setItems(current => [data.item, ...current.filter(v => v.id !== data.item.id)]); }
      if (!r.ok || !data.ok) throw Error(data.error);
      setMessage(action === "publish" ? "日本語版を公開しました。英語版は翻訳待ちです。" : action === "withdraw" ? "公開を取り下げました。" : "下書きを保存しました。");
    } catch (e) { setMessage(errors[(e as Error).message] || "処理を完了できませんでした。入力を残しています。公開に失敗した場合も、下書きは保存されていることがあります。"); }
    finally { setBusy(false); }
  }
  async function more() {
    setBusy(true); try { const r = await fetch(`/api/research/author?offset=${offset}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) }); const d = await r.json(); if (!r.ok || !d.ok) throw Error(); setItems(v => [...v, ...d.items.filter((item: EditorialPost) => !v.some(x => x.id === item.id))]); setOffset(d.nextOffset); } catch { setMessage("以前の投稿を読み込めませんでした。"); } finally { setBusy(false); }
  }
  return <main className={styles.main}><header><p>RIZEL’S DESK</p><h1>ひとりごとを書く</h1><Link href="/research/account">マイアカウント</Link> · <Link href="/research/notes">読者のページ</Link></header>
    <p role="status">{message}</p>
    {!ready && <p><Link href="/research/account">運営者としてログイン</Link></p>}
    {ready && note && <div className={styles.layout}><nav aria-label="自分の投稿"><button disabled={busy || dirty} onClick={() => { const value = empty(); setNote(value); setSaved(JSON.stringify(value)); }}>新しく書く</button>{items.map(item => <button key={item.id} disabled={busy || dirty} onClick={() => select(item)}>{item.titleJa || "無題"}<small>{item.status === "published" ? "公開中" : "非公開"}</small></button>)}{offset !== null && <button disabled={busy} onClick={() => void more()}>以前の投稿</button>}</nav>
      <section className={styles.editor}><div className={styles.saveBar}><div><strong>{note.status === "published" ? "公開中" : "下書き"}</strong><span>{dirty ? "未保存" : note.version ? "保存済み" : "新しい投稿"}</span></div><button disabled={busy || !dirty} onClick={() => void write("draft")}>下書き保存</button></div>
        <fieldset disabled={busy}><label>見出し<input value={note.titleJa} maxLength={180} onChange={e => setNote({ ...note, titleJa: e.target.value })} /></label><label>本文<textarea className={styles.body} value={note.bodyJa} maxLength={6000} onChange={e => setNote({ ...note, bodyJa: e.target.value })} /><small className={styles.counter}>{note.bodyJa.length.toLocaleString()} / 6,000文字</small></label></fieldset>
        <p>日本語だけで公開できます。本文はPRO会員向けです。現在、自動翻訳は接続準備中です。</p>
        {note.status === "published" && <p>下書き保存すると一度非公開になります。修正内容をすぐ反映する場合は「更新して公開」を押してください。</p>}
        <div className={styles.actions}><button disabled={busy || !note.titleJa.trim() || !note.bodyJa.trim() || (note.status === "published" && !dirty)} onClick={() => void write("publish")}>{note.status === "published" ? "更新して公開" : "日本語で公開"}</button>{note.status === "published" && <button disabled={busy || dirty} onClick={() => void write("withdraw")}>公開を取り下げる</button>}{dirty && <button disabled={busy} onClick={() => { if (saved) setNote(JSON.parse(saved)); else { const value = empty(); setNote(value); setSaved(JSON.stringify(value)); } }}>未保存の変更を破棄</button>}</div>
      </section></div>}
  </main>;
}
