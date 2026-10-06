"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStockFavorites } from "../use-stock-favorites";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import FavoriteSchedule from "./favorite-schedule";
import styles from "./watchlist.module.css";

type Company = { ticker: string; name: string; sector: { ja: string; en: string } };
export default function Watchlist({ companies }: { companies: Company[] }) {
  const [lang, setLang] = useResearchLanguage();
  const { favorites, toggle, error } = useStockFavorites();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState("saved");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Company[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (adding) searchInput.current?.focus(); }, [adding]);
  useEffect(() => {
    const q = query.trim();
    setMatches([]);
    setSearchError(false);
    setSearching(Boolean(q) && adding);
    if (!q || !adding) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(q)}&limit=24`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("search-failed");
        if (!controller.signal.aborted) setMatches((data.results ?? []).map((entry: { ticker: string; name: string; exchange: string }) => ({ ticker: entry.ticker, name: entry.name, sector: { ja: entry.exchange, en: entry.exchange } })));
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, adding]);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const filtered = query.trim() ? matches : companies.slice(0, 8);
  const ordered = sort === "ticker" ? [...favorites].sort() : favorites;
  function closeSearch() { setAdding(false); setQuery(""); addButton.current?.focus(); }
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("お気に入り", "Favorites")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>MY WATCHLIST</span><h1>{t("お気に入り", "Favorites")}<small aria-label={t(`${favorites.length}銘柄`, `${favorites.length} stocks`)} aria-live="polite">{favorites.length}</small></h1></div>
        <button ref={addButton} className={styles.add} aria-expanded={adding} aria-controls="favorite-search" onClick={() => adding ? closeSearch() : setAdding(true)}><span aria-hidden="true">{adding ? "−" : "+"}</span>{t("銘柄を追加", "Add stock")}</button>
      </div>
      {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
      {adding && <section id="favorite-search" className={styles.searchPanel} aria-label={t("銘柄を追加", "Add stock")} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }}>
        <div className={styles.searchRow}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input ref={searchInput} aria-label={t("銘柄を検索", "Search stocks")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("会社名・ティッカーで検索", "Search company or ticker")} /><button className={styles.iconButton} onClick={closeSearch} aria-label={t("検索を閉じる", "Close search")}>×</button></div>
        <div role="status" className={styles.searchStatus}>{searching ? t("検索中…", "Searching…") : searchError ? t("検索できませんでした。もう一度お試しください。", "Search unavailable. Please try again.") : query.trim() && !filtered.length ? t("一致する銘柄がありません", "No matching stocks") : null}</div>
        <ul className={styles.choices}>{filtered.map((company) => <li key={company.ticker}><button onClick={() => toggle(company.ticker)} aria-pressed={favorites.includes(company.ticker)} aria-label={t(`${company.name}をお気に入り${favorites.includes(company.ticker) ? "から解除" : "に追加"}`, `${favorites.includes(company.ticker) ? "Remove" : "Add"} ${company.name} ${favorites.includes(company.ticker) ? "from" : "to"} favorites`)}><span><strong>{company.ticker}</strong><small>{company.name}</small></span><span className={styles.choiceAction} aria-hidden="true">{favorites.includes(company.ticker) ? "✓" : "+"}</span></button></li>)}</ul>
      </section>}
      {favorites.length > 0 ? <>
        <div className={styles.toolbar}><label><span className={styles.srOnly}>{t("並び順", "Sort order")}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="ticker">{t("ティッカー順", "Ticker A–Z")}</option></select></label><button onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? t("完了", "Done") : t("編集", "Edit")}</button></div>
        <ul className={styles.cards}>{ordered.map((ticker) => {
          const company = companies.find((item) => item.ticker === ticker);
          return <li key={ticker} className={styles.card}>
            <Link href={company ? `/research/companies/${ticker}` : `/research/stocks?q=${encodeURIComponent(ticker)}`} className={styles.stockLink}>
              <strong>{ticker}</strong><span className={styles.companyName}>{company?.name ?? ticker}</span><span className={styles.cardBottom}><small>{company?.sector[lang] ?? t("米国株", "U.S. stock")}</small><span aria-hidden="true">→</span></span>
            </Link>
            {editing ? <button className={styles.remove} onClick={() => toggle(ticker)} aria-label={t(`${ticker}をお気に入りから解除`, `Remove ${ticker} from favorites`)}>×</button> : <span className={styles.star} aria-hidden="true">★</span>}
          </li>;
        })}</ul>
        <FavoriteSchedule favorites={favorites} lang={lang} />
      </> : <div className={styles.empty}><span aria-hidden="true" className={styles.emptyStar}>☆</span><h2>{t("気になる銘柄を、ここに。", "Your stocks. One place.")}</h2><button className={styles.add} onClick={() => { setAdding(true); searchInput.current?.focus(); }}>{t("最初の銘柄を追加", "Add your first stock")}<span aria-hidden="true">＋</span></button></div>}
      <footer className={styles.footer}><span>{t("このブラウザーに保存", "Saved in this browser")}</span><Link href="/research/stocks">{t("銘柄検索", "Stock search")}<span aria-hidden="true"> →</span></Link></footer>
    </div>
  </ResearchToolShell>;
}
