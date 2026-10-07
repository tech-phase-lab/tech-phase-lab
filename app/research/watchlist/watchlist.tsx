"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFavoriteLists } from "./use-favorite-lists";
import { moveFavorite, usableFavoriteQuote, type FavoriteQuote } from "@/lib/research/favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import { TradingViewChart } from "../stocks/tradingview-chart";
import FavoriteSchedule from "./favorite-schedule";
import styles from "./watchlist.module.css";

type Company = { ticker: string; name: string; sector: { ja: string; en: string }; exchange?: string };
type SearchEntry = { ticker: string; name: string; exchange: string };
const fromEntry = (entry: SearchEntry): Company => ({ ...entry, sector: { ja: entry.exchange, en: entry.exchange } });

export default function Watchlist({ companies, quotes = {} }: { companies: Company[]; quotes?: Record<string, FavoriteQuote> }) {
  const [lang, setLang] = useResearchLanguage();
  const { lists, names, update, error } = useFavoriteLists();
  const [listId, setListId] = useState("default");
  const list = lists.find(item => item.id === listId) ?? lists[0];
  const favorites = list.tickers;
  const [listAction, setListAction] = useState<"create" | "rename" | "delete" | null>(null);
  const [listName, setListName] = useState("");
  function toggle(ticker: string, name?: string) {
    return update(current => ({ ...current, names: name ? { ...current.names, [ticker]: name } : current.names,
      lists: current.lists.map(item => item.id !== list.id ? item : { ...item, tickers: item.tickers.includes(ticker) ? item.tickers.filter(value => value !== ticker) : [...item.tickers, ticker].slice(0, 100) }) }));
  }
  function move(ticker: string, delta: number) {
    update(current => ({ ...current, lists: current.lists.map(item => item.id === list.id ? { ...item, tickers: moveFavorite(item.tickers, ticker, delta) } : item) }));
  }
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState("saved");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Company[]>([]);
  const [known, setKnown] = useState<Record<string, Company>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const active = favorites.includes(selected) ? selected : "";
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
      <header className={styles.heading}><h1>{t("お気に入り", "Favorites")}<small aria-live="polite">{favorites.length}</small></h1></header>
      <div className={styles.listBar}>
        <select aria-label={t("お気に入りリスト", "Favorite list")} value={list.id} onChange={event => { setListId(event.target.value); setSelected(""); setQuery(""); setListAction(null); }}>{lists.map(item => <option key={item.id} value={item.id}>{item.name || t("マイリスト", "My list")}</option>)}</select>
        <button onClick={() => { setListAction("rename"); setListName(list.name || t("マイリスト", "My list")); }} aria-label={t("リスト名を変更", "Rename list")}>✎</button>
        <button disabled={lists.length >= 20} onClick={() => { setListAction("create"); setListName(""); }}>{t("＋リスト", "+ List")}</button>
        {list.id !== "default" && <button onClick={() => setListAction("delete")} aria-label={t("リストを削除", "Delete list")}>×</button>}
      </div>
      {listAction && <form className={styles.listForm} onSubmit={event => {
        event.preventDefault();
        if (listAction === "delete") {
          if (update(current => ({ ...current, lists: current.lists.filter(item => item.id !== list.id) }))) { setListId("default"); setListAction(null); setSelected(""); }
          return;
        }
        const name = listName.trim(); if (!name) return;
        const id = listAction === "create" ? crypto.randomUUID() : list.id;
        if (update(current => ({ ...current, lists: listAction === "create" ? [...current.lists, { id, name, tickers: [] }] : current.lists.map(item => item.id === id ? { ...item, name } : item) }))) { setListId(id); setSelected(""); setListAction(null); }
      }}>
        {listAction === "delete" ? <span>{t(`「${list.name}」を削除しますか？`, `Delete “${list.name}”?`)}</span> : <input aria-label={t("リスト名", "List name")} placeholder={t("保有株、半導体など", "Holdings, Semiconductors…")} value={listName} onChange={event => setListName(event.target.value)} maxLength={40} required />}
        <button type="submit">{listAction === "delete" ? t("削除", "Delete") : t("保存", "Save")}</button><button type="button" onClick={() => setListAction(null)}>{t("取消", "Cancel")}</button>
      </form>}
      <section className={styles.searchPanel} aria-label={t("銘柄を追加", "Add stock")}>
        <div className={styles.searchRow}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input ref={searchInput} type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("銘柄を追加：会社名・ティッカーで検索", "Add stock: search company or ticker")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("銘柄を追加・検索", "Find a stock to add")} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} />{query && <button className={styles.iconButton} onClick={() => { setQuery(""); searchInput.current?.focus(); }} aria-label={t("検索をクリア", "Clear search")}>×</button>}</div>
        {query.trim() && <div className={styles.results}><div role="status" className={styles.searchStatus}>{searching ? t("検索中…", "Searching…") : searchError ? t("検索できませんでした。もう一度お試しください。", "Search unavailable. Please try again.") : !matches.length ? t("一致する銘柄がありません", "No matching stocks") : null}</div>
          <ul className={styles.choices}>{matches.map(item => <li key={item.ticker}><button disabled={favorites.includes(item.ticker)} onClick={() => { setKnown(previous => ({ ...previous, [item.ticker]: item })); toggle(item.ticker, item.name); setQuery(""); searchInput.current?.blur(); }}><span><strong>{item.ticker}</strong><small>{item.name}</small></span><span className={styles.choiceAction}>{favorites.includes(item.ticker) ? t("追加済み", "Added") : t("＋追加", "+ Add")}</span></button></li>)}</ul>
        </div>}
      </section>
      {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
      {favorites.length > 0 ? <>
        <div className={styles.toolbar}><label><span className={styles.srOnly}>{t("並び順", "Sort order")}</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="ticker">{t("ティッカー順", "Ticker A–Z")}</option></select></label><button onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? t("完了", "Done") : t("編集", "Edit")}</button></div>
        <div className={styles.quoteTable}>
          <div className={styles.tableHead}><span>{t("銘柄", "Stock")}</span><span>{t("株価", "Price")}</span><span>{t("前日比", "Change")}</span><span /></div>
          <ul className={styles.quoteRows}>{ordered.map((ticker, index) => {
            const item = companies.find(entry => entry.ticker === ticker) ?? known[ticker];
            const quote = usableFavoriteQuote(quotes[ticker], ticker) ? quotes[ticker] : null;
            const number = (value: number) => value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
            const session = quote ? { regular: t("通常取引", "Regular"), pre: t("プレマーケット", "Pre-market"), post: t("時間外", "After-hours"), closed: t("終値", "Close") }[quote.session] : "";
            return <li key={ticker} className={styles.quoteRow} data-selected={ticker === active}>
              <button className={styles.rowMain} aria-expanded={ticker === active} onClick={() => setSelected(active === ticker ? "" : ticker)}>
                <span className={styles.identity}><strong>{item?.name ?? names[ticker] ?? ticker}</strong><small>{ticker}</small></span>
                <span className={styles.price}>{quote ? number(quote.price) : "—"}<small>{quote ? `${quote.currency} · ${session}${quote.delayed ? t("・遅延", " · delayed") : ""}` : ""}</small>{quote && <time dateTime={quote.asOf}>{new Date(quote.asOf).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>}</span>
                <span className={styles.change} data-direction={quote?.percentChange == null ? "flat" : quote.percentChange > 0 ? "up" : quote.percentChange < 0 ? "down" : "flat"}>{quote?.percentChange == null ? "—" : `${signed(quote.percentChange)}%`}<small>{quote?.change == null ? "" : signed(quote.change)}</small></span>
                <span className={styles.chevron} aria-hidden="true">{ticker === active ? "−" : "+"}</span>
              </button>
              {editing && <div className={styles.rowEdit}><button disabled={sort !== "saved" || index === 0} onClick={() => move(ticker, -1)} aria-label={t(`${ticker}を上へ`, `Move ${ticker} up`)}>↑</button><button disabled={sort !== "saved" || index === ordered.length - 1} onClick={() => move(ticker, 1)} aria-label={t(`${ticker}を下へ`, `Move ${ticker} down`)}>↓</button><button onClick={() => toggle(ticker)} aria-label={t(`${ticker}をこのリストから解除`, `Remove ${ticker} from this list`)}>{t("削除", "Remove")}</button></div>}
              {ticker === active && <section className={styles.detail} aria-label={t(`${ticker}の詳細`, `${ticker} details`)}>
                <div className={styles.detailHeading}><h2>{item?.name ?? names[ticker] ?? ticker}</h2><Link href={monitored ? `/research/companies/${ticker}` : `/research/stocks?q=${encodeURIComponent(ticker)}`}>{t("銘柄情報", "Company")} →</Link></div>
                {ticker === "SKHY" ? <a href="https://www.tradingview.com/symbols/KRX-000660/" target="_blank" rel="noreferrer">SK hynix · TradingView ↗</a> : <TradingViewChart ticker={ticker} exchange={item?.exchange ?? ""} lang={lang} />}
              </section>}
            </li>;
          })}</ul>
          <div className={styles.attribution}>{favorites.some(ticker => usableFavoriteQuote(quotes[ticker], ticker)) ? <>Source: <a href="https://twelvedata.com" target="_blank" rel="noopener">Twelve Data</a></> : <span>{t("一覧の株価はTwelve Data接続後に表示します", "List prices will appear once Twelve Data is connected")}</span>}</div>
        </div>
        <FavoriteSchedule favorites={favorites} lang={lang} />
      </> : <div className={styles.empty}><span aria-hidden="true" className={styles.emptyStar}>☆</span><h2>{t("いつもの銘柄を、ひとつの画面に。", "Your stocks, together.")}</h2><p>{t("上の検索欄から追加できます", "Add a stock using the search above")}</p></div>}
      <footer className={styles.footer}><span>{t("このブラウザーに保存", "Saved in this browser")}</span><Link href="/research/stocks">{t("銘柄検索", "Stock search")} →</Link></footer>
    </div>
  </ResearchToolShell>;
}
