"use client";
import { useEffect, useRef, useState } from "react";
import { clock } from "./audio-editor";
import styles from "./inbox-sheet.module.css";

type Item = { id: string; at: string; seconds: number; isNew: boolean };
const fmt = (at: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(at));
const FILE = (id: string) => `/api/research/desk-inbox?id=${encodeURIComponent(id)}`;

/** Voice memos sent from the phone (an iPhone shortcut), newest first. Choosing one only makes it a candidate for attachment. */
export default function InboxSheet({ onPick, onClose }: { onPick: (file: File) => void; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null), [enabled, setEnabled] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(""), [playing, setPlaying] = useState("");
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
      const response = await fetch(FILE(item.id), { cache: "no-store", signal: AbortSignal.timeout(60000) });
      const blob = await response.blob(); if (!response.ok || blob.size < 512) throw Error();
      onPick(new File([blob], `voice-memo-${item.id}.m4a`, { type: "audio/mp4" }));
    } catch { setError("この音声を取り込めませんでした。"); setBusy(""); }
  }
  return <div className={styles.wrap} role="dialog" aria-modal="true" aria-label="受信箱">
    <button type="button" className={styles.backdrop} aria-label="閉じる" onClick={onClose} />
    <div className={styles.sheet}>
      <i className={styles.grip} aria-hidden="true" />
      <h2>受信箱<small>スマホから送った音声</small></h2>
      {items === null && !error && <p className={styles.note} role="status">読み込んでいます…</p>}
      {items?.length === 0 && <p className={styles.note} role="status">{enabled ? "まだ届いている音声はありません。" : "スマホからの受け取りは、準備中です。"}</p>}
      {items?.map(item => <div className={styles.row} key={item.id}>
        <button type="button" className={styles.play} aria-label={playing === item.id ? "一時停止" : "再生"} onClick={() => toggle(item.id)}>
          {playing === item.id ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
        </button>
        <div className={styles.when}><b>{fmt(item.at, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/^(\d+)\/(\d+)/, "$1月$2日")}{item.isNew && <em>NEW</em>}</b><small>{fmt(item.at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} ・ {clock(item.seconds)}</small></div>
        <button type="button" className={styles.pick} disabled={!!busy} onClick={() => void choose(item)}>{busy === item.id ? "取り込み中…" : "選ぶ"}</button>
      </div>)}
      {error && <p className={styles.note} role="status">{error}</p>}
      <p className={styles.foot}>選ぶと、添付に追加されます。あとから切り取りもできます。</p>
      <audio ref={player} hidden onEnded={() => setPlaying("")} onPause={() => setPlaying("")} />
    </div>
  </div>;
}
