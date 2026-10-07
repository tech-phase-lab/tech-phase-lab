"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStockFavorites } from "../use-stock-favorites";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import { TradingViewChart } from "../stocks/tradingview-chart";
import FavoriteSchedule from "./favorite-schedule";
import styles from "./watchlist.module.css";

type Company = { ticker: string; name: string; sector: { ja: string; en: string }; exchange?: string };
type SearchEntry = { ticker: string; name: string; exchange: string };
const fromEntry = (entry: SearchEntry): Company => ({ ...entry, sector: { ja: entry.exchange, en: entry.exchange } });

export default function Watchlist({ companies }: { companies: Company[] }) {
  const [lang, setLang] = useResearchLanguage();
  const { favorites, toggle, error } = useStockFavorites();
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState("saved");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Company[]>([]);
  const [known, setKnown] = useState<Record<string, Company>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const active = favorites.includes(selected) ? selected : favorites[0];
  const company = companies.find(item => item.ticker === active) ?? known[active];
  const needsName = Boolean(active && !company);
  useEffect(() => {
    if (!needsName) return;
    const controller = new AbortController();
    fetch(`/api/research/stocks?q=${encodeURIComponent(active)}&limit=24`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const entry = data?.ok && data.results?.find((item: SearchEntry) => item.ticker === active);
        if (entry && !controller.signal.aborted) setKnown(previous => ({ ...previous, [active]: fromEntry(entry) }));
      }).catch(() => {});
    return () => controller.abort();
  }, [active, needsName]);
  useEffect(() => {
    const q = query.trim();
    setMatches([]);
    setSearchError(false);
    setSearching(Boolean(q));
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(q)}&limit=24`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("search-failed");
        if (!controller.signal.aborted) setMatches((data.results ?? []).map(fromEntry));
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const ordered = sort === "ticker" ? [...favorites].sort() : favorites;
  const monitored = companies.some(item => item.ticker === active);
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("お気に入り", "Favorites")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><h1>{t("お気に入り", "Favorites")}<small aria-live="polite">{favorites.length}</small></h1><span className={styles.free}>FREE</span></header>
      <section className={styles.searchPanel} aria-label={t("銘柄を追加", "Add stock")}>
        <div className={styles.searchRow}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input ref={searchInput} type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("銘柄を追加：会社名・ティッカーで検索", "Add stock: search company or ticker")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("銘柄を追加・検索", "Find a stock to add")} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} />{query && <button className={styles.iconButton} onClick={() => { setQuery(""); searchInput.current?.focus(); }} aria-label={t("検索をクリア", "Clear search")}>×</button>}</div>
        {query.trim() && <div className={styles.results}><div role="status" className={styles.searchStatus}>{searching ? t("検索中…", "Searching…") : searchError ? t("検索できませんでした。もう一度お試しください。", "Search unavailable. Please try again.") : !matches.length ? t("一致する銘柄がありません", "No matching stocks") : null}</div>
          <ul className={styles.choices}>{matches.map(item => <li key={item.ticker}><button disabled={favorites.includes(item.ticker)} onClick={() => { setKnown(previous => ({ ...previous, [item.ticker]: item })); toggle(item.ticker); setSelected(item.ticker); setQuery(""); searchInput.current?.blur(); }}><span><strong>{item.ticker}</strong><small>{item.name}</small></span><span className={styles.choiceAction}>{favorites.includes(item.ticker) ? t("追加済み", "Added") : t("＋追加", "+ Add")}</span></button></li>)}</ul>
        </div>}
      </section>
      {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
      {favorites.length > 0 ? <>
        <div className={styles.toolbar}><label><span className={styles.srOnly}>{t("並び順", "Sort order")}</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="ticker">{t("ティッカー順", "Ticker A–Z")}</option></select></label><button onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? t("完了", "Done") : t("編集", "Edit")}</button></div>
        <div className={styles.workspace}>
          <ul className={styles.cards} aria-label={t("保存した銘柄", "Saved stocks")}>{ordered.map(ticker => {
            const item = companies.find(entry => entry.ticker === ticker) ?? known[ticker];
            return <li key={ticker} className={styles.card} data-selected={ticker === active}><button className={styles.stockLink} aria-pressed={ticker === active} aria-controls="favorite-stock-view" onClick={() => setSelected(ticker)}><strong>{ticker}</strong><span className={styles.companyName}>{item?.name ?? t("株価・チャートを見る", "View quote & chart")}</span><span className={styles.cardBottom}>{item?.sector[lang]}</span></button>{editing && <button className={styles.remove} onClick={() => toggle(ticker)} aria-label={t(`${ticker}をお気に入りから解除`, `Remove ${ticker} from favorites`)}>×</button>}</li>;
          })}</ul>
          <section id="favorite-stock-view" className={styles.detail} aria-label={t(`${active}の株価・チャート`, `${active} quote & chart`)}>
            <div className={styles.detailHeading}><div><span>{active}</span><h2>{company?.name ?? active}</h2></div><Link href={monitored ? `/research/companies/${active}` : `/research/stocks?q=${encodeURIComponent(active)}`}>{t("銘柄情報", "Company")} ↗</Link></div>
            {active === "SKHY" ? <p className={styles.scheduleNote}><a href="https://www.tradingview.com/symbols/KRX-000660/" target="_blank" rel="noreferrer">SK hynix · TradingView ↗</a></p> : <TradingViewChart ticker={active} exchange={company?.exchange ?? ""} lang={lang} />}
          </section>
        </div>
        <FavoriteSchedule favorites={favorites} lang={lang} />
      </> : <div className={styles.empty}><span aria-hidden="true" className={styles.emptyStar}>☆</span><h2>{t("いつもの銘柄を、ひとつの画面に。", "Your stocks, together.")}</h2><p>{t("上の検索欄から追加できます", "Add a stock using the search above")}</p></div>}
      <footer className={styles.footer}><span>{t("このブラウザーに保存", "Saved in this browser")}</span><Link href="/research/stocks">{t("銘柄検索", "Stock search")} →</Link></footer>
    </div>
  </ResearchToolShell>;
}
