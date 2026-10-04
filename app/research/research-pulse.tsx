"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { newsPulseItems } from "@/lib/research/news-pulse-items";
import { fitPulseHeadline } from "@/lib/research/news-pulse-headline";
import { recentPublication, shortNewsTime } from "@/lib/research/news-time";
import styles from "./research-pulse.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
function FittedHeadline({ headlines, lang, label }: { headlines: string[]; lang: Language; label: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const key = headlines.join("\n");
  const [selected, setSelected] = useState({ key: "", text: "" });
  // Start with an honest compact topic until real font metrics are available.
  const text = selected.key === key ? selected.text : headlines.at(-1) ?? "";
  useEffect(() => {
    const target = element.current;
    const context = document.createElement("canvas").getContext("2d");
    if (!target || !context) return;
    let active = true;
    let frame = 0;
    const update = () => {
      if (!active) return;
      const font = getComputedStyle(target);
      context.font = font.font || `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
      const next = fitPulseHeadline(key.split("\n"), Math.max(0, target.clientWidth - 4), value => context.measureText(value).width);
      setSelected(previous => previous.key === key && previous.text === next ? previous : { key, text: next });
    };
    const request = () => {
      if (!active || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const observer = new ResizeObserver(request);
    observer.observe(target);
    void document.fonts.ready.then(request);
    return () => { active = false; observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [key]);
  return <span ref={element} className={styles.headline} lang={lang} aria-label={`${label}: ${text}`}>{text}</span>;
}

export default function ResearchPulse({ lang }: { lang: Language }) {
  const snapshot = useSyncExternalStore(subscribeNews, newsSnapshot, serverNewsSnapshot);
  const feed = snapshot?.data;
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [position, setPosition] = useState({first: "", index: 0});
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const touch = useRef<{x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const ja = lang === "ja";
  const items = newsPulseItems(feed, lang);
  const first = items[0]?.id ?? "";
  const stopped = paused || interacting || reduced;
  useEffect(() => {
    if (stopped || items.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + 1) % items.length})); }, 8000);
    return () => clearInterval(timer);
  }, [stopped, items.length, first]);
  function move(direction: number) {
    if (items.length < 2) return;
    setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + direction + items.length) % items.length}));
  }
  const item = items[(position.first === first ? position.index : 0) % items.length];
  if (!item) return null;
  const timestamp = shortNewsTime(item.at, item.kind);
  const fresh = recentPublication(item.at, item.kind, snapshot?.checkedAt ?? 0);
  return <section className={styles.pulse} aria-label={ja ? "新着ニュース" : "Latest news"} data-paused={stopped} tabIndex={0}
    onTouchStart={event => { suppressClick.current = false; const point = event.touches[0]; touch.current = event.touches.length === 1 ? {x: point.clientX, y: point.clientY} : null; setInteracting(true); }}
    onTouchEnd={event => { const start = touch.current; const end = event.changedTouches[0]; touch.current = null; setInteracting(false); if (!start || !end) return; const dx = end.clientX - start.x; const dy = end.clientY - start.y; if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppressClick.current = true; move(dx < 0 ? 1 : -1); } }}
    onTouchCancel={() => { touch.current = null; setInteracting(false); }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <FittedHeadline key={item.id} headlines={item.headlines} lang={lang} label={item.ticker} />
    <time className={styles.clock} dateTime={item.at} title={timestamp} aria-label={`${item.kind === "observed" ? (ja ? "取得 " : "Found ") : ""}${timestamp}`}>
      {item.kind === "observed" ? (ja ? "取得 " : "Found ") : ""}<span className={styles.fullTime}>{timestamp}</span><span className={styles.shortTime} aria-hidden="true">{timestamp.replace(/ JST$/, "")}</span>{fresh && <b className={styles.fresh}>NEW</b>}
    </time>
    <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-pressed={paused} aria-label={paused ? (ja ? "自動切替を再開" : "Resume rotation") : (ja ? "自動切替を停止" : "Pause rotation")}>{paused || reduced ? "▶" : "Ⅱ"}</button>
    {!stopped && items.length > 1 && <i key={`${item.id}-progress`} className={styles.progress} aria-hidden="true" />}
  </section>;
}
