"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./index-strip.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
function QuoteFrame({ src, title }: { src: string; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(180);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / 200)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function resize(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "tech-phase-quote-height" && Number.isFinite(data.height) && data.height >= 40 && data.height <= 400) setHeight(Math.ceil(data.height));
    }
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  return <div ref={container} className={styles.quoteViewport} style={{ height: height * scale }}><iframe ref={frame} src={src} title={title} style={{ height, width: scale < 1 ? 200 : "100%", transform: `scale(${scale})` }} /></div>;
}
export default function IndexStrip({ lang, compact = false }: { lang: Language; compact?: boolean }) {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [paused, setPaused] = useState(false);
  const moving = !reduced && !paused;
  const names = lang === "ja" ? ["ダウ", "NASDAQ 100", "S&P 500"] : ["Dow", "NASDAQ 100", "S&P 500"];
  return <section className={styles.strip} aria-label={lang === "ja" ? "主要3指数のCFD参考値" : "Three index CFD reference quotes"}>
    <div className={styles.heading}><small>{lang === "ja" ? "主要指数 · CFD参考値" : "Major indices · Indicative CFDs"}</small>{compact && !reduced && <button onClick={() => setPaused(!paused)}>{moving ? (lang === "ja" ? "動きを止める" : "Pause") : (lang === "ja" ? "再開" : "Resume")}</button>}</div>
    {compact ? <iframe key={`${lang}-${moving}`} className={styles.tape} src={`/research/market/ticker-widget?lang=${lang}&moving=${moving ? 1 : 0}`} title={lang === "ja" ? "株価ティッカー" : "Market ticker"} /> : <div className={styles.cards}>{names.map((name, index) => <div key={name}><strong>{name}</strong><QuoteFrame src={`/research/market/ticker-widget?lang=${lang}&single=${index}`} title={`${name} · CFD`} /></div>)}</div>}
  </section>;
}
