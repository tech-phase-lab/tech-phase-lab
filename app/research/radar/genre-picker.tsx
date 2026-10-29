"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { radarGenres, type RadarGenreId } from "@/lib/research/radar";
import styles from "./genre-picker.module.css";

const ICONS: Record<RadarGenreId, ReactNode> = {
  "ai-cloud": <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z" />,
  semis: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></>,
  memory: <><rect x="4" y="8" width="16" height="8" rx="1.5" /><path d="M8 8v8M12 8v8M16 8v8M6 19v-3M10 19v-3M14 19v-3M18 19v-3" /></>,
  network: <><path d="M5 10a10 10 0 0 1 14 0M8 13a6 6 0 0 1 8 0" /><circle cx="12" cy="17" r="1.4" /></>,
  photonics: <path d="M3 12h6l3-6 3 12 3-6h3" />,
  software: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  power: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  cyber: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
};
const Icon = ({ id, size }: { id: RadarGenreId; size: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[id]}</svg>;
const Chevron = ({ flip }: { flip?: boolean }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}><path d="M15 5l-7 7 7 7" /></svg>;

/** Genre chooser: a card with arrows and swipe, and a sheet from the bottom that lists every genre. */
export default function GenrePicker({ lang, value, onChange }: { lang: "ja" | "en"; value: RadarGenreId; onChange: (id: RadarGenreId) => void }) {
  const ja = lang === "ja";
  const [open, setOpen] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const index = Math.max(0, radarGenres.findIndex(genre => genre.id === value));
  const current = radarGenres[index];
  const name = (genre: typeof current) => ja ? genre.ja : genre.en;
  const move = (step: number) => onChange(radarGenres[(index + step + radarGenres.length) % radarGenres.length].id);
  useEffect(() => {
    if (!open) return;
    const keep = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closer.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    const button = opener.current;
    return () => { document.body.style.overflow = keep; window.removeEventListener("keydown", key); button?.focus({ preventScroll: true }); };
  }, [open]);
  return <>
    <section className={styles.card} aria-label={ja ? "ジャンル" : "Genre"}
      onTouchStart={event => { const point = event.touches[0]; touch.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null; }}
      onTouchEnd={event => {
        const start = touch.current; touch.current = null;
        if (!start) return;
        const point = event.changedTouches[0], dx = point.clientX - start.x, dy = point.clientY - start.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
      }}>
      <div className={styles.top}>
        <span className={styles.count}>GENRE · {index + 1} / {radarGenres.length}</span>
        <button ref={opener} type="button" className={styles.all} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>▦ {ja ? "一覧" : "All"}</button>
      </div>
      <div className={styles.row}>
        <button type="button" className={styles.arrow} aria-label={ja ? "前のジャンル" : "Previous genre"} onClick={() => move(-1)}><Chevron /></button>
        <button type="button" className={styles.name} onClick={() => setOpen(true)} aria-label={`${name(current)} (${ja ? "ジャンルを選ぶ" : "Choose a genre"})`}>
          <strong>{name(current)}</strong>
          <small>{current.tickers.join(" ")}</small>
        </button>
        <button type="button" className={styles.arrow} aria-label={ja ? "次のジャンル" : "Next genre"} onClick={() => move(1)}><Chevron flip /></button>
      </div>
      <div className={styles.dashes} aria-hidden="true">{radarGenres.map(genre => <i key={genre.id} className={genre.id === value ? styles.on : ""} />)}</div>
    </section>
    {open && createPortal(<div className={styles.layer}>
      <button type="button" className={styles.backdrop} aria-label={ja ? "閉じる" : "Close"} tabIndex={-1} onClick={() => setOpen(false)} />
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={ja ? "ジャンルを選ぶ" : "Choose a genre"}>
        <span className={styles.handle} aria-hidden="true" />
        <header><h2>{ja ? "ジャンルを選ぶ" : "Choose a genre"}</h2><button ref={closer} type="button" className={styles.close} aria-label={ja ? "閉じる" : "Close"} onClick={() => setOpen(false)}>×</button></header>
        <div className={styles.grid}>
          {radarGenres.map(genre => {
            const on = genre.id === value;
            return <button type="button" key={genre.id} className={`${styles.option} ${on ? styles.selected : ""}`} aria-pressed={on} onClick={() => { onChange(genre.id); setOpen(false); }}>
              <span className={styles.icon}><Icon id={genre.id} size={26} /></span>
              <b>{name(genre)}</b>
              <small>{ja ? `${genre.tickers.length}銘柄` : `${genre.tickers.length} tickers`}</small>
              <code>{genre.tickers.slice(0, 3).join(" ")}</code>
              {on && <i className={styles.check} aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#06241a" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i>}
            </button>;
          })}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
