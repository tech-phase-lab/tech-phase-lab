"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { officialHeadlineJa } from "@/lib/research/official-news-ja";
import { officialTime, recentPublication, shortNewsTime } from "@/lib/research/news-time";
import styles from "./research-pulse.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
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
  const items = [
    ...(feed?.officialUpdates ?? []).map(item => ({id: `official-${item.id}`, ticker: item.tickers.join(" · "), title: ja ? officialHeadlineJa(item.url) ?? item.translationJa ?? "公式アップデート（日本語訳を準備中）" : item.title, url: item.url, ...officialTime(item)})),
    ...(feed?.items ?? []).map(item => ({id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, url: item.url, at: item.publishedAt, kind: "published" as const}))
  ].sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).slice(0,5);
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
  return <section className={styles.pulse} aria-label={ja ? "新着ニュース" : "Latest news"} data-paused={stopped}
    onTouchStart={event => { suppressClick.current = false; const point = event.touches[0]; touch.current = event.touches.length === 1 ? {x: point.clientX, y: point.clientY} : null; setInteracting(true); }}
    onTouchEnd={event => { const start = touch.current; const end = event.changedTouches[0]; touch.current = null; setInteracting(false); if (!start || !end) return; const dx = end.clientX - start.x; const dy = end.clientY - start.y; if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppressClick.current = true; move(dx < 0 ? 1 : -1); } }}
    onTouchCancel={() => { touch.current = null; setInteracting(false); }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <span className={styles.label}>{ja ? "ニュース" : "NEWS"}</span>
    <a key={item.id} className={styles.item} href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.ticker}</strong><span>{item.title}</span><time dateTime={item.at}>{item.kind === "observed" ? (ja ? "取得 " : "Found ") : ""}{timestamp} {fresh && <b className={styles.fresh}>NEW</b>}</time></a>
    <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={paused ? (ja ? "自動切替を再開" : "Resume rotation") : (ja ? "自動切替を停止" : "Pause rotation")}>{paused || reduced ? "▶" : "Ⅱ"}</button>
    {!stopped && items.length > 1 && <i key={`${item.id}-progress`} className={styles.progress} aria-hidden="true" />}
  </section>;
}
