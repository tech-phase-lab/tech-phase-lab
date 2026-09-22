"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./stock-search-history.module.css";

export default function StockSearchHistory({ lang, history, onSelect, onClear }: {
  lang: Language; history: string[]; onSelect: (ticker: string) => void; onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const listId = useId();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => {
      const widths = Array.from(measure.current?.children ?? [], (node) => node.getBoundingClientRect().width);
      const width = element.clientWidth;
      const total = widths.reduce((sum, item) => sum + item, 0) + Math.max(0, widths.length - 1) * 6;
      const available = total <= width ? width : Math.max(0, width - 42);
      let used = 0;
      let count = 0;
      for (const item of widths) {
        const next = used + (count ? 6 : 0) + item;
        if (next > available) break;
        used = next; count += 1;
      }
      setLimit(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const node of Array.from(measure.current?.children ?? [])) observer.observe(node);
    return () => observer.disconnect();
  }, [history]);
  const overflow = limit < history.length;
  return <section className={styles.root} aria-label={t("履歴", "History")}>
    <div className={styles.heading}><strong>{t("履歴", "History")}</strong>{history.length > 0 && <button type="button" onClick={() => { setExpanded(false); onClear(); }}>{t("消去", "Clear")}</button>}</div>
    <div className={styles.row} ref={row}>
      {history.length ? <><ul id={listId} className={styles.list}>{history.map((ticker, index) => <li key={ticker} hidden={!expanded && index >= limit}><button type="button" className={styles.chip} onClick={() => onSelect(ticker)} aria-label={t(`${ticker}を再検索`, `Search ${ticker} again`)}>{ticker}</button></li>)}</ul>
      {overflow && <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={listId} aria-label={expanded ? t("履歴を折りたたむ", "Collapse history") : t("すべての履歴を表示", "Show all history")} onClick={() => setExpanded(!expanded)}>{expanded ? "▲" : "▼"}</button>}</> : <span className={styles.empty}>{t("まだ履歴はありません", "No history yet")}</span>}
      <div ref={measure} className={styles.measure} aria-hidden="true">{history.map((ticker) => <span className={styles.chip} key={ticker}>{ticker}</span>)}</div>
    </div>
  </section>;
}
