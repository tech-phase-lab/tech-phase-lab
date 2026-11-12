"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WATCH_TICKERS } from "@/lib/research/flash-rows";
import { bandItems, bandLead, bandParts } from "@/lib/research/news-band";
import type { Language } from "@/lib/research/data";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { takeWireStartup } from "@/lib/research/news-startup";
import { newsPulseItems } from "@/lib/research/news-pulse-items";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { pulseClock } from "@/lib/research/news-time";
import { publishWire } from "@/lib/research/wire-store";
import styles from "./research-pulse.module.css";
const subscribeWide = (callback: () => void) => { const media = window.matchMedia("(min-width: 900px)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
const subscribe = (callback: () => void) => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); };
/** Most company headlines are longer than the band allows, so the newest 40 stories can hold none that fit (Nov 5: the band went empty).
 * The band looks through a wide pool and keeps the newest stories that have a short headline. */
const PULSE_POOL = 400;
/** A finger that moves at least this far sideways is a swipe; one that moves less than TAP_PX is a tap. */
const SWIPE_PX = 36;
const TAP_PX = 10;
/** One headline every five seconds (owner, Nov 4). */
const ROTATE_MS = 5000;
/** The headline starts at 14.5px and shrinks by 0.5px to 12.5px; only then is it cut with "…". */
const START_PX = 14.5;
const MIN_PX = 12.5;
const STEP_PX = 0.5;
/** Largest size, from the start size down, at which the text fits its box; the minimum when none does. */
export function fitFontSize(fits: (size: number) => boolean) {
  let size = START_PX;
  while (size > MIN_PX && !fits(size)) size -= STEP_PX;
  return size;
}

type BandLine = { id: string; band: string; ticker: string; at: string; kind: string };
function Line({ line, ja, leaving }: { line: BandLine; ja: boolean; leaving?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let frame = 0;
    const fit = () => { frame = 0; target.style.fontSize = `${fitFontSize(size => { target.style.fontSize = `${size}px`; return target.scrollWidth <= target.clientWidth; })}px`; };
    const request = () => { if (!frame) frame = requestAnimationFrame(fit); };
    fit();
    const observer = new ResizeObserver(request);
    observer.observe(target);
    void document.fonts.ready.then(request);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [line.band]);
  const symbols = [...line.ticker.split(/[\s·]+/), ...WATCH_TICKERS];
  // A headline that does not name its company gets the symbol in front (owner, Nov 12: "which company is this about?").
  const lead = bandLead(line.ticker, line.band);
  // Japan time in Japanese and U.S. Eastern time in English, as before.
  const timestamp = pulseClock(line.at, line.kind, ja);
  return <div className={`${styles.item} ${leaving ? styles.out : styles.in}`} aria-hidden={leaving || undefined}>
    <span className={styles.live}>LIVE</span>
    <span ref={element} className={styles.hd} lang={ja ? "ja" : "en"} title={line.band}>
      {lead ? <><b className={styles.sym}>{lead}</b>{" "}</> : null}
      {bandParts(line.band, symbols).map((part, index) => part.symbol ? <b key={index} className={styles.sym}>{part.text}</b> : part.text)}
    </span>
    <time className={styles.tm} dateTime={line.at} title={timestamp}>{timestamp}</time>
  </div>;
}

type PulseItem = ReturnType<typeof newsPulseItems>[number];
// Owner, Oct 25: opening on an empty strip and then showing it reads worse than opening on the headlines seen last
// time and letting them change, so the strip remembers its latest headlines on this device (display only).
const PULSE_CACHE_KEY = "tech-phase:pulse-items:v1";
// Remembered headlines are shown only for a quick reload (owner, Oct 28: after a few hours they flashed old news before the new).
const PULSE_CACHE_MS = 60_000;
function readPulseCache(lang: Language): PulseItem[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PULSE_CACHE_KEY) ?? "null") as { lang?: string; savedAt?: number; items?: PulseItem[] } | null;
    return saved?.lang === lang && Number.isFinite(saved.savedAt) && Date.now() - saved.savedAt! < PULSE_CACHE_MS && Array.isArray(saved.items) ? saved.items : [];
  } catch { return []; }
}
function writePulseCache(lang: Language, items: PulseItem[]) {
  try { window.localStorage.setItem(PULSE_CACHE_KEY, JSON.stringify({ lang, savedAt: Date.now(), items: items.slice(0, 8) })); } catch { /* storage may be blocked */ }
}

export default function ResearchPulse({ lang }: { lang: Language }) {
  const snapshot = useSyncExternalStore(subscribeNews, newsSnapshot, serverNewsSnapshot);
  const feed = snapshot?.data;
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia("(min-width: 900px)").matches, () => false);
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const [position, setPosition] = useState({first: "", index: 0});
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState<BandLine | null>(null);
  const [flash, setFlash] = useState(0);
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
  const live = snapshot?.checkedAt && wireSettled ? newsPulseItems(feed, lang, snapshot.checkedAt, wire, PULSE_POOL) : [];
  const [remembered, setRemembered] = useState<PulseItem[]>([]);
  useEffect(() => { setRemembered(readPulseCache(lang)); }, [lang]);
  const liveKey = live.map(item => item.id).join("|");
  useEffect(() => { if (live.length) writePulseCache(lang, bandItems(live, ja, 8, wide)); }, [lang, liveKey, wide]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only stories with a short headline are shown; the rest stay in the news list and the band moves on to the next.
  const items = bandItems(live.length ? live : remembered, ja, 5, wide);
  const first = items[0]?.id ?? "";
  // Pressing the band holds the headline; letting go resumes. Reduced motion stops everything.
  const stopped = held || reduced;
  const current = items.length ? (position.first === first ? position.index : 0) % items.length : 0;
  const item = items[current];
  const previous = useRef<BandLine | null>(null);
  const pressX = useRef<number | null>(null);
  const shownId = item?.id;
  useEffect(() => {
    const before = previous.current;
    previous.current = item ?? null;
    if (!before || !item || before.id === item.id || reduced) return;
    setLeaving(before); setFlash(value => value + 1);
    const timer = setTimeout(() => setLeaving(null), 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, reduced]);
  useEffect(() => {
    if (stopped || items.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setPosition(value => ({first, index: ((value.first === first ? value.index : 0) + 1) % items.length})); }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [stopped, items.length, first]);
  if (!item) return gaveUp ? null : <div className={styles.slot} aria-hidden="true" />;
  const release = () => setHeld(false);
  // A tap, or a swipe left, shows the next headline; a swipe right shows the one before (owner, Nov 5).
  const go = (step: number) => { if (items.length > 1) setPosition({ first, index: (current + step + items.length) % items.length }); };
  const finish = (x: number) => {
    const start = pressX.current; pressX.current = null; release();
    if (start === null) return;
    const moved = x - start;
    if (Math.abs(moved) >= SWIPE_PX) go(moved < 0 ? 1 : -1); else if (Math.abs(moved) < TAP_PX) go(1);
  };
  return <section className={styles.pulse} aria-label={ja ? "新着ニュース" : "Latest news"} data-paused={stopped}
    onPointerDown={event => { pressX.current = event?.clientX ?? 0; setHeld(true); }} onPointerUp={event => finish(event?.clientX ?? 0)}
    onPointerCancel={() => { pressX.current = null; release(); }} onPointerLeave={() => { pressX.current = null; release(); }}>
    <div className={styles.strip} aria-live="polite">
      {leaving && <Line key={`out-${leaving.id}`} line={leaving} ja={ja} leaving />}
      <Line key={item.id} line={item} ja={ja} />
    </div>
    <div key={flash} className={flash && !reduced ? `${styles.wave} ${styles.flash}` : styles.wave} aria-hidden="true" />
  </section>;
}
