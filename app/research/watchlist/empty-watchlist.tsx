"use client";

import styles from "./empty-watchlist.module.css";

/** Quick-add suggestions shown while a list is empty, in this order (4 columns by 2 rows). */
export const emptyWatchlistSuggestions = ["NVDA", "MU", "AMD", "AVGO", "NBIS", "GOOGL", "SNDK", "META"] as const;
const SAMPLE_ROWS = [
  { ticker: "NVDA", line: "0,22 14,26 28,16 42,22 56,10 70,16 80,8" },
  { ticker: "MU", line: "0,10 14,18 28,8 42,20 56,14 70,24 80,12" },
  { ticker: "AVGO", line: "0,24 14,22 28,26 42,16 56,20 70,12 80,16" },
] as const;

/** The screen of a list with no stock yet. No real prices: the sample rows are drawn shapes only. */
export default function EmptyWatchlist({ lang, listName, disabled, onAdd }: { lang: "ja" | "en"; listName: string; disabled: boolean; onAdd: (ticker: string) => void }) {
  const ja = lang === "ja";
  return <section className={styles.empty} aria-label={ja ? "ウォッチリストは空です" : "Your watchlist is empty"}>
    <div className={styles.glow} aria-hidden="true" />
    <svg className={styles.art} width="132" height="132" viewBox="0 0 132 132" fill="none" aria-hidden="true">
      <circle cx="66" cy="66" r="64" stroke="#1f3a33" />
      <circle cx="66" cy="66" r="46" stroke="#2a5646" strokeDasharray="2 5" />
      <circle cx="66" cy="66" r="28" stroke="#3a7b63" strokeWidth="1.2" />
      <path d="M66 2v18M66 112v18M2 66h18M112 66h18" stroke="#2a5646" />
      <path d="M66 66L112 30" stroke="#7ad8ab" strokeWidth="1.2" opacity=".55" />
      <path d="M66 66L112 30A64 64 0 0 0 66 2z" fill="url(#watchlist-sweep)" opacity=".35" />
      <defs><linearGradient id="watchlist-sweep" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#7ad8ab" stopOpacity="0" /><stop offset="1" stopColor="#7ad8ab" stopOpacity=".55" /></linearGradient></defs>
      <path d="M66 51l4.4 9.2 10.1 1.4-7.3 7.1 1.8 10.1L66 74l-9 4.8 1.8-10.1-7.3-7.1 10.1-1.4z" fill="#0b1712" stroke="#d9b56a" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
    <h2>{ja ? "いつもの銘柄を、ひとつの画面に。" : "Your stocks, together."}</h2>
    <p>{ja ? <>気になる銘柄を追加すると<br />価格と前日比がここに並びます</> : <>Add the stocks you follow and<br />prices and daily change will line up here</>}</p>
    <div className={styles.previewHead} aria-hidden="true"><span>PREVIEW</span><i /></div>
    <ul className={styles.sample} aria-hidden="true">
      {SAMPLE_ROWS.map(row => <li key={row.ticker}>
        <b>{row.ticker}</b>
        <svg viewBox="0 0 80 32" width="80" height="32" fill="none"><polyline points={row.line} stroke="#2f5a4b" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
        <span className={styles.bars}><i /><i /></span>
      </li>)}
    </ul>
    <p className={styles.startLabel}>{ja ? "まずはここから追加" : "Start with these"}</p>
    <div className={styles.suggestions}>
      {emptyWatchlistSuggestions.map(ticker => <button key={ticker} type="button" disabled={disabled} onClick={() => onAdd(ticker)}>＋{ticker}</button>)}
    </div>
    <p className={styles.note}>{ja ? `タップすると、${listName}に追加されます` : `Tap to add to ${listName}`}</p>
  </section>;
}
