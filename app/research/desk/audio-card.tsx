"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { clock } from "./audio-editor";
import styles from "./audio-card.module.css";

function duration(file: File): Promise<number> {
  return new Promise(resolve => {
    if (typeof Audio === "undefined") { resolve(0); return; }
    const url = URL.createObjectURL(file), audio = new Audio();
    const done = (value: number) => { audio.removeAttribute("src"); URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value : 0); };
    audio.preload = "metadata"; audio.onloadedmetadata = () => done(audio.duration); audio.onerror = () => done(0); audio.src = url;
  });
}

/** The audio waiting to be attached: a play button, its name and length, "編集" and "×", over a waveform. Nothing is uploaded from here. */
export default function AudioCard({ file, original, title, onTitle, edited, preview, hold, busy, edit, onRemove }: { file: File; original: File | null; title: string; onTitle: (value: string) => void; edited: boolean; preview: string; hold: boolean; busy: boolean; edit: ReactNode; onRemove: () => void }) {
  const player = useRef<HTMLAudioElement>(null);
  const [bars, setBars] = useState<number[]>([]), [seconds, setSeconds] = useState(0), [before, setBefore] = useState(0), [playing, setPlaying] = useState(false);
  useEffect(() => {
    let dead = false;
    void duration(file).then(value => { if (!dead) setSeconds(value); });
    void (original && original !== file ? duration(original) : Promise.resolve(0)).then(value => { if (!dead) setBefore(value); });
    (async () => {
      let context: AudioContext | null = null;
      try {
        if (typeof AudioContext === "undefined") return;
        context = new AudioContext();
        const buffer = await context.decodeAudioData(await file.arrayBuffer()), channel = buffer.getChannelData(0), count = 56, size = Math.max(1, Math.floor(channel.length / count)), peaks: number[] = [];
        for (let i = 0; i < count; i++) { let peak = 0; for (let j = i * size; j < Math.min(channel.length, (i + 1) * size); j += Math.max(1, Math.floor(size / 24))) peak = Math.max(peak, Math.abs(channel[j])); peaks.push(peak); }
        const top = Math.max(0.05, ...peaks);
        if (!dead) setBars(peaks.map(value => Math.max(0.08, value / top)));
      } catch { /* the waveform is only decoration */ } finally { if (context && context.state !== "closed") void context.close(); }
    })();
    return () => { dead = true; };
  }, [file, original]);
  useEffect(() => { if (hold) player.current?.pause(); }, [hold]);
  function toggle() { const audio = player.current; if (!audio) return; if (audio.paused) void audio.play().catch(() => setPlaying(false)); else audio.pause(); }
  return <div className={styles.card}>
    <div className={styles.top}>
      <button type="button" className={styles.play} aria-label={playing ? "一時停止" : "再生"} onClick={toggle}>
        {playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>}
      </button>
      <div className={styles.name}><input className={styles.title} type="text" aria-label="音声のタイトル" maxLength={80} value={title} placeholder="音声メモ" disabled={busy} onChange={event => onTitle(event.target.value)} /><small>{edited && before ? `${clock(before)} ・ 編集済み ${clock(seconds)}` : seconds ? clock(seconds) : ""}</small></div>
      {edit}
      <button type="button" className={styles.remove} aria-label="この音声を外す" disabled={busy} onClick={onRemove}>×</button>
    </div>
    <div className={styles.bars} aria-hidden="true">{(bars.length ? bars : Array.from({ length: 56 }, (_, i) => 0.2 + 0.15 * Math.abs(Math.sin(i / 3)))).map((height, index) => <i key={index} style={{ height: `${Math.round(height * 100)}%` }} />)}</div>
    <audio ref={player} src={preview} preload="metadata" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
  </div>;
}
