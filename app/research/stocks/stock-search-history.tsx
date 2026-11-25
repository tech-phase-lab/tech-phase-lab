"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./stock-search-history.module.css";

/** Recent searches (owner, Nov 25): one row of chips however many there are, scrolled sideways, the right edge fading while more chips lie
 * beyond it. 「消去」 clears them. */
export default function StockSearchHistory({ lang, history, onSelect, onClear }: {
  lang: Language; history: string[]; onSelect: (ticker: string) => void; onClear: () => void;
}) {
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => setMore(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => { element.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [history]);
  return <section className={styles.root} aria-label={t("履歴", "Recent searches")}>
    <div className={styles.heading}><strong>{t("履歴", "Recent searches")}</strong>{history.length > 0 && <button type="button" onClick={onClear}>{t("消去", "Clear")}</button>}</div>
    {history.length ? <ul ref={row} className={styles.list} data-more={more || undefined}>{history.map((ticker) => <li key={ticker}><button type="button" className={styles.chip} onClick={() => onSelect(ticker)} aria-label={t(`${ticker}を再検索`, `Search ${ticker} again`)}>{ticker}</button></li>)}</ul>
      : <span className={styles.empty}>{t("まだ履歴はありません", "No recent searches")}</span>}
  </section>;
}
