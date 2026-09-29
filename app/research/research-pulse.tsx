"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { officialHeadlineJa } from "@/lib/research/official-news-ja";
import styles from "./research-pulse.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
export default function ResearchPulse({ lang }: { lang: Language }) {
  const snapshot = useSyncExternalStore(subscribeNews, newsSnapshot, serverNewsSnapshot);
  const feed = snapshot?.data;
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [position, setPosition] = useState({first: "", index: 0});
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const ja = lang === "ja";
  const items = [
    ...(feed?.officialUpdates ?? []).map(item => ({id: `official-${item.id}`, ticker: item.tickers.join(" · "), title: ja ? officialHeadlineJa(item.url) ?? "公式アップデート（日本語訳を準備中）" : item.title, url: item.url, at: item.observedAt, observed: true})),
    ...(feed?.items ?? []).map(item => ({id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, url: item.url, at: item.publishedAt, observed: false}))
  ].sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).slice(0,5);
  const first = items[0]?.id ?? "";
  const stopped = paused || interacting || reduced;
  useEffect(() => {
    if (stopped || items.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + 1) % items.length})); }, 8000);
    return () => clearInterval(timer);
  }, [stopped, items.length, first]);
  const item = items[(position.first === first ? position.index : 0) % items.length];
  if (!item) return null;
  const timestamp = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(item.at)).replace(",", "");
  const age = (snapshot?.checkedAt ?? 0) - Date.parse(item.at);
  const fresh = age >= 0 && age < 60 * 60 * 1000;
  return <section className={styles.pulse} aria-label={ja ? "新着ニュース" : "Latest news"} data-paused={stopped} onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <span className={styles.label}>{ja ? "ニュース" : "NEWS"}</span>
    <a key={item.id} className={styles.item} href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.ticker}</strong><span>{item.title}</span><time dateTime={item.at}>{item.observed ? (ja ? "取得 " : "Found ") : ""}{timestamp} JST {fresh && <b className={styles.fresh}>NEW</b>}</time></a>
    <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={paused ? (ja ? "自動切替を再開" : "Resume rotation") : (ja ? "自動切替を停止" : "Pause rotation")}>{paused || reduced ? "▶" : "Ⅱ"}</button>
    {!stopped && items.length > 1 && <i key={`${item.id}-progress`} className={styles.progress} aria-hidden="true" />}
  </section>;
}
