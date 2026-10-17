"use client";

import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import WatchlistFrame from "./watchlist-frame";
import { PendingRows } from "./pending-rows";
import styles from "./watchlist.module.css";

export default function WatchlistLoading() {
  const [lang, setLang] = useResearchLanguage();
  return <WatchlistFrame lang={lang}><ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><h1>{lang === "ja" ? "ウォッチリスト" : "Watchlist"}</h1></header>
      <div className={styles.controls}><section className={styles.searchPanel} aria-hidden="true"><div className={styles.searchRow}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input disabled tabIndex={-1} placeholder={lang === "ja" ? "銘柄を追加・検索" : "Find a stock to add"} />
      </div></section></div>
      <PendingRows lang={lang} />
    </div>
  </ResearchToolShell></WatchlistFrame>;
}
