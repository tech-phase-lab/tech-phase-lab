"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import { hasLogo, logoSrc } from "../watchlist/stock-logo";
import styles from "./stock-search-history.module.css";

/** A round logo for the history pills only (owner, Nov 26): the square tile (public/logos, with its own white or dark ground) sits whole in a
 * circle of that same ground, its corners on the circle (≈70% of it), so no mark is cut (Microsoft's four squares). No tile: the initial. */
function RoundLogo({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState("");
  const usable = hasLogo(ticker) && failed !== ticker;
  // The circle takes the tile's own ground: the tile's corner, enlarged (every tile's 11px border is its ground colour).
  return <span className={styles.logo} aria-hidden="true" style={usable ? { backgroundImage: `url(${logoSrc(ticker)})` } : undefined}>{usable
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={logoSrc(ticker)} alt="" width={72} height={72} loading="lazy" decoding="async" onError={() => setFailed(ticker)} />
    : ticker.slice(0, 1)}</span>;
}

/** Recent stocks (owner, Nov 26): a clock and 「履歴」, then as many pills as fit on one line, newest first (the rest are not drawn), and a
 * round × that clears them all. A pill opens that stock. */
export default function StockSearchHistory({ lang, history, onSelect, onClear }: {
  lang: Language; history: string[]; onSelect: (ticker: string) => void; onClear: () => void;
}) {
  const row = useRef<HTMLUListElement>(null);
  const [shown, setShown] = useState(history.length);
  const ja = lang === "ja";
  // The pills wrap onto lines the row clips; only those on its first line stay in the page's tab order and reading order.
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => {
      const items = [...element.children] as HTMLElement[];
      const top = items[0]?.offsetTop ?? 0;
      setShown(items.filter(item => item.offsetTop === top).length);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [history]);
  if (!history.length) return null;
  return <section className={styles.root} aria-label={ja ? "履歴" : "Recent"}>
    <span className={styles.label} aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6.3" /><path d="M8 4.6V8l2.3 1.5" /></svg>{ja ? "履歴" : "RECENT"}</span>
    <ul ref={row} className={styles.list}>{history.map((ticker, index) => <li key={ticker} inert={index >= shown || undefined}>
      <button type="button" className={styles.chip} onClick={() => onSelect(ticker)} aria-label={ja ? `${ticker}を開く` : `Open ${ticker}`}><RoundLogo ticker={ticker} /><b>{ticker}</b></button>
    </li>)}</ul>
    <button type="button" className={styles.clear} onClick={onClear} aria-label={ja ? "履歴をすべて消去" : "Clear all recent"}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg></button>
  </section>;
}
