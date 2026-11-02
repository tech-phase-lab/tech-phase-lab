"use client";
import { useEffect, useRef, useState } from "react";
import { maxDeskAudioBytes } from "@/lib/research/desk-audio";
import { clock } from "./audio-editor";
import styles from "./inbox-sheet.module.css";

type Item = { id: string; title: string; at: string; seconds: number | null; isNew: boolean };
const fmt = (at: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(at));
const FILE = (id: string) => `/api/research/desk-inbox?id=${encodeURIComponent(id)}`;
const post = (body: object) => fetch("/api/research/desk-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

/** Voice memos sent from the phone (an iPhone shortcut), newest first. Choosing one only makes it a candidate for attachment. */
export default function InboxSheet({ onPick, onClose }: { onPick: (file: File) => void; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null), [enabled, setEnabled] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(""), [playing, setPlaying] = useState("");
  const [renaming, setRenaming] = useState(""), [draft, setDraft] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/desk-inbox", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.ok || !Array.isArray(data.items)) throw Error();
      if (!controller.signal.aborted) { setEnabled(data.enabled === true); setItems(data.items); }
    }).catch(() => { if (!controller.signal.aborted) setError("受信箱を読み込めませんでした。"); });
    return () => controller.abort();
  }, []);
  function toggle(id: string) {
    const audio = player.current; if (!audio) return;
    if (playing === id) { audio.pause(); setPlaying(""); return; }
    audio.src = FILE(id); setPlaying(id); void audio.play().catch(() => setPlaying(""));
  }
  async function choose(item: Item) {
    if (busy) return;
    setBusy(item.id); setError("");
    try {
      const response = await fetch(FILE(item.id), { cache: "no-store", signal: AbortSignal.timeout(120000) });
      const blob = await response.blob(); if (!response.ok || blob.size < 512) throw Error();
      const extension = blob.type.includes("mpeg") ? "mp3" : blob.type.includes("mp4") ? "m4a" : "wav";
      // Attaching takes MP3 and M4A up to 50 MB; a larger or WAV memo stays in the inbox.
      if (extension === "wav" || blob.size > maxDeskAudioBytes) { setError("この音声は、いまは添付できません(MP3・M4Aの50MBまで)。"); setBusy(""); return; }
      void post({ action: "read", id: item.id }).catch(() => undefined);
      onPick(new File([blob], `${item.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 70) || "音声メモ"}.${extension}`, { type: blob.type }));
    } catch { setError("この音声を取り込めませんでした。"); setBusy(""); }
  }
  async function save(item: Item) {
    const title = draft.trim();
    if (!title) return;
    try {
      const response = await post({ action: "rename", id: item.id, title });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      setItems(current => current?.map(row => row.id === item.id ? { ...row, title: data.item.title } : row) ?? null); setRenaming("");
    } catch { setError("タイトルを変えられませんでした。"); }
  }
  return <div className={styles.wrap} role="dialog" aria-modal="true" aria-label="受信箱">
    <button type="button" className={styles.backdrop} aria-label="閉じる" onClick={onClose} />
    <div className={styles.sheet}>
      <i className={styles.grip} aria-hidden="true" />
      <h2>受信箱<small>スマホから送った音声</small></h2>
      {items === null && !error && <p className={styles.note} role="status">読み込んでいます…</p>}
      {items?.length === 0 && <p className={styles.note} role="status">{enabled ? "まだ届いている音声はありません。" : "スマホから送るには、先に「受信箱の鍵」を作ってください。"}</p>}
      {items?.map(item => <div className={styles.row} key={item.id}>
        <button type="button" className={styles.play} aria-label={playing === item.id ? "一時停止" : "再生"} onClick={() => toggle(item.id)}>
          {playing === item.id ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
        </button>
        <div className={styles.when}>
          {renaming === item.id
            ? <input className={styles.titleInput} autoFocus aria-label="音声のタイトル" maxLength={80} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void save(item); if (event.key === "Escape") setRenaming(""); }} />
            : <b>{item.title}{item.isNew && <em>NEW</em>}</b>}
          <small>{fmt(item.at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}{item.seconds ? ` ・ ${clock(item.seconds)}` : ""}</small>
        </div>
        {renaming === item.id
          ? <button type="button" className={styles.pick} disabled={!draft.trim()} onClick={() => void save(item)}>保存</button>
          : <><button type="button" className={styles.rename} aria-label="タイトルを変える" onClick={() => { setRenaming(item.id); setDraft(item.title); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.800 2.800 0 0 0-4-4L4 15z" /></svg></button>
            <button type="button" className={styles.pick} disabled={!!busy} onClick={() => void choose(item)}>{busy === item.id ? "取り込み中…" : "選ぶ"}</button></>}
      </div>)}
      {error && <p className={styles.note} role="status">{error}</p>}
      <p className={styles.foot}>選ぶと、添付に追加されます。あとから切り取りもできます。</p>
      <p className={styles.foot}>{/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain link keeps this sheet free of the router, so it also mounts in the unit tests */}
      <a href="/research/inbox-key" onClick={onClose}>受信箱の鍵と送り先 ›</a></p>
      <audio ref={player} hidden onEnded={() => setPlaying("")} onPause={() => setPlaying("")} />
    </div>
  </div>;
}
