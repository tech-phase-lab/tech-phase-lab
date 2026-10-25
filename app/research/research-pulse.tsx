"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { takeWireStartup } from "@/lib/research/news-startup";
import { newsPulseItems } from "@/lib/research/news-pulse-items";
import { isGenericPulseLabel, pickPulseLine } from "@/lib/research/news-pulse-headline";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { pulseClock } from "@/lib/research/news-time";
import { publishWire } from "@/lib/research/wire-store";
import styles from "./research-pulse.module.css";
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
// The headline is 13.5px in the stylesheet; measuring at another size made some lines overflow and others look bigger (owner, Oct 16).
const BASE_FONT_PX = 13.5;
const MIN_FONT_PX = 12;
/** A long headline slides at a readable pace (owner, Oct 16: too fast to read); a one-way slide takes 70% of the cycle. */
const SCROLL_PX_PER_SECOND = 35;
const scrollSeconds = (shift: number) => Math.max(6, shift / SCROLL_PX_PER_SECOND / 0.7);
function FittedHeadline({ headlines, full, lang, label, onSlide }: { headlines: string[]; full: string; lang: Language; label: string; onSlide?: (milliseconds: number) => void }) {
  const element = useRef<HTMLSpanElement>(null);
  const key = [full, ...headlines].join("\n");
  const [selected, setSelected] = useState({ key: "", text: "", clipped: false, size: BASE_FONT_PX, shift: 0 });
  // Until real font metrics are available, show the shortest informative
  // headline (clipped by CSS if needed) rather than a bare category label.
  const initial = headlines.findLast(value => !isGenericPulseLabel(value)) ?? (full || headlines.at(-1) || "");
  const { text, clipped, size, shift } = selected.key === key ? selected : { text: initial, clipped: true, size: BASE_FONT_PX, shift: 0 };
  useEffect(() => {
    // The strip waits until the end of the headline has been on screen for a moment before it rotates.
    onSlide?.(clipped && shift > 0 ? Math.round(scrollSeconds(shift) * 850 + 2000) : 0);
  }, [clipped, shift, onSlide]);
  useEffect(() => {
    const target = element.current;
    const context = document.createElement("canvas").getContext("2d");
    if (!target || !context) return;
    let active = true;
    let frame = 0;
    const update = () => {
      if (!active) return;
      const font = getComputedStyle(target);
      // Always measure at the base size so a shrunk line never changes the choice.
      context.font = `${font.fontWeight} ${BASE_FONT_PX}px ${font.fontFamily}`;
      const [title, ...choices] = key.split("\n");
      const width = Math.max(0, target.clientWidth - 4);
      const picked = pickPulseLine(choices, title, width, value => context.measureText(value).width);
      // A line slightly too long is shown smaller instead of cut with "…".
      const scaled = picked.clipped ? BASE_FONT_PX * width / Math.max(1, context.measureText(picked.text).width) : BASE_FONT_PX;
      // Still too long at the smallest size: it slides to its end and back, again and again, in the
      // same single row, so it never stops at its last words and never takes a second line (owner, Oct 15).
      const next = scaled >= MIN_FONT_PX
        ? { text: picked.text, clipped: false, size: Math.min(BASE_FONT_PX, Math.floor(scaled * 10) / 10), shift: 0 }
        : { ...picked, size: MIN_FONT_PX, shift: Math.ceil(context.measureText(picked.text).width * MIN_FONT_PX / BASE_FONT_PX - width) };
      setSelected(previous => previous.key === key && previous.text === next.text && previous.clipped === next.clipped && previous.size === next.size && previous.shift === next.shift ? previous : { key, ...next });
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
  return <span ref={element} className={clipped ? `${styles.headline} ${styles.clipped}` : styles.headline} lang={lang}
    style={size < BASE_FONT_PX ? { fontSize: `${size}px` } : undefined}
    title={clipped ? text : undefined} aria-label={`${label}: ${text}`}>
    {clipped && shift > 0 ? <span className={styles.scroll} style={{ "--shift": `-${shift}px`, "--duration": `${scrollSeconds(shift).toFixed(1)}s` } as React.CSSProperties}>{text}</span> : text}
  </span>;
}

export default function ResearchPulse({ lang }: { lang: Language }) {
  const snapshot = useSyncExternalStore(subscribeNews, newsSnapshot, serverNewsSnapshot);
  const feed = snapshot?.data;
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [position, setPosition] = useState({first: "", index: 0});
  const [paused, setPaused] = useState(false);
  const [slideMs, setSlideMs] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const touch = useRef<{x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const ja = lang === "ja";
  const [wire, setWire] = useState<Record<string, CompanyWireItem[]>>({});
  // Owner, Oct 25: the strip must not open on the news-only headline and then jump to a newer company headline,
  // so it waits for the first company-wire answer (or a short grace period) before it shows anything.
  const [wireSettled, setWireSettled] = useState(false);
  // Keep the strip's space reserved while it loads so the page below does not jump down when it appears;
  // if nothing ever arrives the space is released after a while.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setGaveUp(true), 8_000); return () => clearTimeout(timer); }, []);
  const checkedAt = snapshot?.checkedAt;
  useEffect(() => {
    // Company headlines join the strip, refreshed whenever the news feed is; a failure here never affects the rest.
    let alive = true;
    void (async () => {
      try {
        const started = await takeWireStartup();
        if (started) {
          if (!started.error) { const items = parseCompanyWire(started.data).items; if (alive) { setWire(items); publishWire(items); } }
          return;
        }
        const response = await fetch("/api/research/company-wire", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (response.ok) { const items = parseCompanyWire(await response.json()).items; if (alive) { setWire(items); publishWire(items); } }
      } catch { /* keep the previous list */ }
      finally { if (alive) setWireSettled(true); }
    })();
    const grace = setTimeout(() => setWireSettled(true), 2_500);
    return () => { alive = false; clearTimeout(grace); };
  }, [checkedAt]);
  const items = snapshot?.checkedAt && wireSettled ? newsPulseItems(feed, lang, snapshot.checkedAt, wire) : [];
  const first = items[0]?.id ?? "";
  const stopped = paused || interacting || reduced;
  useEffect(() => {
    if (stopped || items.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + 1) % items.length})); }, Math.max(8000, slideMs));
    return () => clearInterval(timer);
  }, [stopped, items.length, first, slideMs]);
  function move(direction: number) {
    if (items.length < 2) return;
    setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + direction + items.length) % items.length}));
  }
  const item = items[(position.first === first ? position.index : 0) % items.length];
  if (!item) return gaveUp ? null : <div className={styles.slot} aria-hidden="true" />;
  // Japanese readers see Japan time; English readers see U.S. Eastern time.
  const timestamp = pulseClock(item.at, item.kind, ja, "observedAt" in item ? item.observedAt : undefined);
  return <section className={styles.pulse} aria-label={ja ? "新着ニュース" : "Latest news"} data-paused={stopped} tabIndex={0}
    onTouchStart={event => { suppressClick.current = false; const point = event.touches[0]; touch.current = event.touches.length === 1 ? {x: point.clientX, y: point.clientY} : null; setInteracting(true); }}
    onTouchEnd={event => { const start = touch.current; const end = event.changedTouches[0]; touch.current = null; setInteracting(false); if (!start || !end) return; const dx = end.clientX - start.x; const dy = end.clientY - start.y; if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppressClick.current = true; move(dx < 0 ? 1 : -1); } }}
    onTouchCancel={() => { touch.current = null; setInteracting(false); }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <FittedHeadline key={item.id} headlines={item.headlines} full={item.title} lang={lang} label={item.ticker} onSlide={setSlideMs} />
    <time className={styles.clock} dateTime={item.at} title={timestamp} aria-label={timestamp}>
      {timestamp}
    </time>
    <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-pressed={paused} aria-label={paused ? (ja ? "自動切替を再開" : "Resume rotation") : (ja ? "自動切替を停止" : "Pause rotation")}>{paused || reduced ? "▶" : "Ⅱ"}</button>
    {!stopped && items.length > 1 && <i key={`${item.id}-progress`} className={styles.progress} aria-hidden="true" />}
  </section>;
}
