"use client";
import { useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./index-strip.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
export default function IndexStrip({ lang, compact = false }: { lang: Language; compact?: boolean }) {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [paused, setPaused] = useState(false);
  const moving = !reduced && !paused;
  const names = lang === "ja" ? ["ダウ", "NASDAQ 100", "S&P 500"] : ["Dow", "NASDAQ 100", "S&P 500"];
  return <section className={styles.strip} aria-label={lang === "ja" ? "主要3指数のCFD参考値" : "Three index CFD reference quotes"}>
    <div className={styles.heading}><small>{lang === "ja" ? "主要指数 · CFD参考値" : "Major indices · Indicative CFDs"}</small>{compact && !reduced && <button onClick={() => setPaused(!paused)}>{moving ? (lang === "ja" ? "動きを止める" : "Pause") : (lang === "ja" ? "再開" : "Resume")}</button>}</div>
    {compact ? <iframe key={`${lang}-${moving}`} className={styles.tape} src={`/research/market/ticker-widget?lang=${lang}&moving=${moving ? 1 : 0}`} title={lang === "ja" ? "株価ティッカー" : "Market ticker"} /> : <div className={styles.cards}>{names.map((name, index) => <div key={name}><strong>{name}</strong><iframe src={`/research/market/ticker-widget?lang=${lang}&single=${index}`} title={`${name} · CFD`} /></div>)}</div>}
  </section>;
}
