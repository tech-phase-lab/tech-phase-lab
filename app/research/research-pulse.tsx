"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language, ResearchEvent } from "@/lib/research/data";
import styles from "./research-pulse.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
export default function ResearchPulse({ events, lang }: { events: ResearchEvent[]; lang: Language }) {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const items = events.slice(0, 5);
  const stopped = paused || interacting || reduced;
  useEffect(() => {
    if (stopped || items.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setIndex(value => (value + 1) % items.length); }, 8000);
    return () => clearInterval(timer);
  }, [stopped, items.length]);
  const item = items[index % items.length];
  if (!item) return null;
  const ja = lang === "ja";
  return <section className={styles.pulse} aria-label={ja ? "公開済みリサーチのピックアップ" : "Published research highlights"} data-paused={stopped} onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <span className={styles.label}>{ja ? "リサーチ PICK UP" : "RESEARCH PICK"}</span>
    <a key={item.id} className={styles.item} href={`#what-changed/${item.id}`}><strong>{item.ticker}</strong><span>{item.title[lang]}</span><time dateTime={item.publishedOn}>{item.publishedOn}</time></a>
    <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={paused ? (ja ? "自動切替を再開" : "Resume rotation") : (ja ? "自動切替を停止" : "Pause rotation")}>{paused || reduced ? "▶" : "Ⅱ"}</button>
    {!stopped && items.length > 1 && <i key={`${item.id}-progress`} className={styles.progress} aria-hidden="true" />}
  </section>;
}
