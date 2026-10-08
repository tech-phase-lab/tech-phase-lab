"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFavoriteLists } from "./use-favorite-lists";
import { watchlistSlots, moveFavorite, sortFavorites, type FavoriteQuote } from "@/lib/research/favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import { TradingViewChart } from "../stocks/tradingview-chart";
import { favoriteIntradayChart } from "@/lib/research/watchlist-chart";
import AreaChart from "./area-chart";
import SwipeRow, { TrashIcon } from "./swipe-row";
import { quoteForSession, type WatchlistSession } from "@/lib/research/watchlist-session";
import StockLogo from "./stock-logo";
import { useWatchlistSectors } from "./use-watchlist-sectors";
import { watchlistSector } from "@/lib/research/watchlist-sector";
import styles from "./watchlist.module.css";

type Company = { ticker: string; name: string; sector?: { ja: string; en: string }; exchange?: string };
type SearchEntry = { ticker: string; name: string; exchange: string };
const fromEntry = (entry: SearchEntry): Company => ({ ticker: entry.ticker, name: entry.name, exchange: entry.exchange });

function CurrentTime() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);
  return <time dateTime={now?.toISOString()}>{now ? now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false }) : "—"}</time>;
}

export default function Watchlist({ companies, quotes = {} }: { companies: Company[]; quotes?: Record<string, FavoriteQuote> }) {
  const [lang, setLang] = useResearchLanguage();
  const { lists, names, alerts = [], update, error, status, retry, canImport, importLocal, editable } = useFavoriteLists();
  const [alertTicker, setAlertTicker] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [alertCurrency, setAlertCurrency] = useState("USD");
  const [listId, setListId] = useState("default");
  const slots = watchlistSlots(lists);
  const list = slots.find(item => item.id === listId) ?? slots[0];
  const favorites = list.tickers;
  const fetchedSectors = useWatchlistSectors(favorites.filter(ticker => !watchlistSector(ticker, companies.find(item => item.ticker === ticker)?.sector)));
  const [listAction, setListAction] = useState<"rename" | null>(null);
  const [listName, setListName] = useState("");
  function toggle(ticker: string, name?: string) {
    return update(current => ({ ...current, names: name ? { ...current.names, [ticker]: name } : current.names,
      lists: watchlistSlots(current.lists).map(item => item.id !== list.id ? item : { ...item, tickers: item.tickers.includes(ticker) ? item.tickers.filter(value => value !== ticker) : [...item.tickers, ticker].slice(0, 100) }) }));
  }
  function move(ticker: string, delta: number) {
    update(current => ({ ...current, lists: current.lists.map(item => item.id === list.id ? { ...item, tickers: moveFavorite(item.tickers, ticker, delta) } : item) }));
  }
  const [sessionView, setSessionView] = useState<WatchlistSession>("auto");
  const [revealed, setRevealed] = useState("");
  function remove(ticker: string) {
    return update(current => ({ ...current, lists: current.lists.map(item => item.id === list.id ? { ...item, tickers: item.tickers.filter(value => value !== ticker) } : item) }));
  }
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
  const sessionLabels = { regular: t("取引中", "Market open"), pre: t("プレマーケット", "Pre-market"), post: t("時間外", "After-hours"), closed: t("前日比", "Daily change") };
  const displayedQuotes: Record<string, FavoriteQuote> = {};
  for (const ticker of favorites) {
    const quote = quoteForSession(quotes[ticker], ticker, sessionView);
    if (quote) displayedQuotes[ticker] = quote;
  }
  const quoteSessions = [...new Set(Object.values(displayedQuotes).map(quote => quote.session))];
  const sharedSession = sessionView !== "auto" ? sessionView : quoteSessions.length === 1 ? quoteSessions[0] : null;
  const ordered = sortFavorites(favorites, displayedQuotes, sort);
  const monitored = companies.some(item => item.ticker === active);
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("ウォッチリスト", "Watchlist")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>{t("ウォッチリスト", "Watchlist")}</h1>
        <div className={styles.listPicker}>
          <span className={styles.pickerArrow} aria-hidden="true">▼</span>
          <select aria-label={t("マイリストを選択", "Choose list")} value={list.id} onChange={event => { setListId(event.target.value); setSelected(""); setQuery(""); setListAction(null); setRevealed(""); }}>
            {slots.map((item, index) => <option key={item.id} value={item.id}>{item.name || t(`マイリスト${index + 1}`, `My list ${index + 1}`)}</option>)}
          </select>
          <button disabled={!editable} className={styles.renameButton} onClick={() => { setListAction(listAction ? null : "rename"); setListName(list.name || t(`マイリスト${slots.indexOf(list) + 1}`, `My list ${slots.indexOf(list) + 1}`)); }} aria-label={t("リスト名を編集", "Edit list name")} aria-expanded={!!listAction}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>
          </button>
        </div>
      </header>
      {listAction && <form className={styles.listForm} onSubmit={event => {
        event.preventDefault();
        const name = listName.trim(); if (!name) return;
        if (update(current => ({ ...current, lists: watchlistSlots(current.lists).map(item => item.id === list.id ? { ...item, name } : item) }))) setListAction(null);
      }}>
        <input aria-label={t("リスト名", "List name")} value={listName} onChange={event => setListName(event.target.value)} maxLength={40} required />
        <button type="submit">{t("保存", "Save")}</button><button type="button" onClick={() => setListAction(null)}>{t("取消", "Cancel")}</button>
      </form>}
      <div className={styles.controls}>
      <section className={styles.searchPanel} aria-label={t("銘柄を追加", "Add stock")}>
        <div className={styles.searchRow}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input ref={searchInput} type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("銘柄を追加：会社名・ティッカーで検索", "Add stock: search company or ticker")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("銘柄を追加・検索", "Find a stock to add")} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} />{query && <button className={styles.iconButton} onClick={() => { setQuery(""); searchInput.current?.focus(); }} aria-label={t("検索をクリア", "Clear search")}>×</button>}</div>
        {query.trim() && <div className={styles.results}><div role="status" className={styles.searchStatus}>{searching ? t("検索中…", "Searching…") : searchError ? t("検索できませんでした。もう一度お試しください。", "Search unavailable. Please try again.") : !matches.length ? t("一致する銘柄がありません", "No matching stocks") : null}</div>
          <ul className={styles.choices}>{matches.map(item => <li key={item.ticker}><button disabled={!editable || favorites.includes(item.ticker)} onClick={() => { setKnown(previous => ({ ...previous, [item.ticker]: item })); if (toggle(item.ticker, item.name)) { setQuery(""); searchInput.current?.blur(); } }}><span><strong>{item.ticker}</strong><small>{item.name}</small></span><span className={styles.choiceAction}>{favorites.includes(item.ticker) ? t("追加済み", "Added") : t("＋追加", "+ Add")}</span></button></li>)}</ul>
        </div>}
      </section>
      {favorites.length > 0 && <div className={styles.toolbar}><label><span className={styles.srOnly}>{t("並び順", "Sort order")}</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="ticker">{t("ティッカー順", "Ticker A–Z")}</option><option value="gainers">{t("上昇率順", "Top gainers")}</option><option value="losers">{t("下落率順", "Top losers")}</option></select></label></div>}
      </div>
      {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
      {favorites.length > 0 ? <>

        <div className={styles.marketBar}><label><span>{t("表示", "View")}</span><select aria-label={t("取引時間帯の表示", "Market session view")} value={sessionView} onChange={event => { setSessionView(event.target.value as WatchlistSession); setRevealed(""); }}><option value="auto">{t("自動", "Auto")}</option><option value="regular">{t("取引中", "Market open")}</option><option value="pre">{t("プレ", "Pre-market")}</option><option value="closed">{t("前日比", "Daily change")}</option></select></label><span>{t("現在", "Now")} <CurrentTime /> JST</span></div>
        <div className={styles.quoteTable}>
          <div className={styles.tableHead}><span>{t("銘柄", "Stock")}</span><span>{sharedSession ? sessionLabels[sharedSession] : t("値動き", "Change")}</span><span>{t("株価", "Price")}</span></div>
          <ul className={styles.quoteRows}>{ordered.map((ticker, index) => {
            const item = companies.find(entry => entry.ticker === ticker) ?? known[ticker];
            const sector = (watchlistSector(ticker, item?.sector) ?? fetchedSectors[ticker])?.[lang];
            const sectorSource = !watchlistSector(ticker, item?.sector) && fetchedSectors[ticker] ? `SEC SIC ${fetchedSectors[ticker].sic}: ${fetchedSectors[ticker].description}` : undefined;
            const quote = displayedQuotes[ticker] ?? null;
            const number = (value: number) => value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
            const session = quote ? sessionLabels[quote.session] : "";
            const chart = quote ? favoriteIntradayChart(quote) : null;
            const direction = quote?.percentChange == null ? "flat" : quote.percentChange > 0 ? "up" : quote.percentChange < 0 ? "down" : "flat";
            return <li key={ticker} className={styles.quoteRow} data-selected={ticker === active}>
              <SwipeRow key={`${list.id}:${ticker}`} open={revealed === ticker} onOpenChange={open => setRevealed(open ? ticker : "")} onRemove={() => remove(ticker)} disabled={!editable} removeLabel={t(`${ticker}をこのリストから削除`, `Remove ${ticker} from this list`)}>
              <button className={styles.rowMain} aria-expanded={ticker === active} onClick={() => setSelected(active === ticker ? "" : ticker)}>
                <span className={styles.identity}><StockLogo ticker={ticker} /><span className={styles.company}><strong>{item?.name ?? names[ticker] ?? ticker}</strong><small>{ticker}</small>{sector && <span className={styles.sector} title={sectorSource}>{sector}</span>}</span></span>
                <span className={styles.trend} data-direction={direction}>
                  <span className={styles.trendHeading}><small>{sharedSession ? "" : session}</small><strong>{quote?.percentChange == null ? "—" : `${signed(quote.percentChange)}%`}</strong></span>
                  {chart ? <AreaChart className={styles.chartFrame} values={chart.values} reference={chart.reference} label={t(`${ticker}の当日の値動き`, `${ticker} intraday trend`)} /> : <span className={styles.noChart} aria-label={t("当日チャート未取得", "Intraday chart unavailable")}>—</span>}
                </span>
                <span className={styles.price} data-direction={direction}>{quote ? number(quote.price) : "—"}<small>{quote ? `${quote.change == null ? "" : signed(quote.change) + " "}${quote.currency}` : ""}</small>{quote && <time className={styles.quoteTime} dateTime={quote.asOf} title={new Date(quote.asOf).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "Asia/Tokyo" }) + " JST"}>{new Date(quote.asOf).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} JST{quote.delayed ? t(" · 遅延", " · Delayed") : ""}</time>}</span>
              </button>
              </SwipeRow>


              {ticker === active && <section className={styles.detail} aria-label={t(`${ticker}の詳細`, `${ticker} details`)}>
                <div className={styles.detailHeading}><h2>{item?.name ?? names[ticker] ?? ticker}</h2><Link href={monitored ? `/research/companies/${ticker}` : `/research/stocks?q=${encodeURIComponent(ticker)}`}>{t("銘柄情報", "Company")} →</Link></div>
                <div className={styles.rowEdit}><button disabled={!editable || sort !== "saved" || index === 0} onClick={() => move(ticker, -1)} aria-label={t(`${ticker}を上へ`, `Move ${ticker} up`)}>↑</button><button disabled={!editable || sort !== "saved" || index === ordered.length - 1} onClick={() => move(ticker, 1)} aria-label={t(`${ticker}を下へ`, `Move ${ticker} down`)}>↓</button><button disabled={!editable} className={styles.deleteButton} onClick={() => remove(ticker)} aria-label={t(`${ticker}をこのリストから削除`, `Remove ${ticker} from this list`)}><TrashIcon /></button></div>
                {quote && <p className={styles.dataTime}>{t("データ時刻", "Data time")} <time dateTime={quote.asOf}>{new Date(quote.asOf).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time> JST · {session}{quote.delayed ? t(" · 遅延", " · Delayed") : ""}</p>}
                {chart && <div className={styles.expandedChart} data-direction={direction}><AreaChart className={styles.largeChart} values={chart.values} reference={chart.reference} label={t("拡大した当日チャート", "Expanded intraday chart")} /><div className={styles.chartTimes}><span>{new Date(chart.start).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })}</span><span>{new Date(chart.end).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })} ET</span></div></div>}
                <button className={styles.alertButton} disabled={!editable} onClick={() => { const saved = alerts.find(a => a.ticker === ticker); setAlertTicker(ticker); setAlertPrice(saved ? String(saved.price) : ""); setAlertDirection(saved?.direction ?? "above"); setAlertCurrency(saved?.currency ?? quote?.currency ?? (ticker === "SKHY" ? "KRW" : "USD")); }}>{t("価格通知を設定", "Set price alert")}{alerts.some(a => a.ticker === ticker) ? t(" · 保存済み", " · Saved") : ""}</button>
                {alertTicker === ticker && <form className={styles.alertForm} onSubmit={event => { event.preventDefault(); const price = Number(alertPrice); if (!Number.isFinite(price) || price <= 0 || price > 1e9) return; if (update(current => ({ ...current, alerts: [...(current.alerts ?? []).filter(a => !(a.ticker === ticker && a.direction === alertDirection)), { ticker, price, direction: alertDirection, currency: alertCurrency }].slice(0, 100) }))) setAlertTicker(""); }}>
                  <p>{t("通知は未稼働です。指定価格を保存できます。", "Alerts are not live yet. You can save a target price.")}</p>
                  <label>{t("指定価格", "Target price")}<input aria-label={t("指定価格", "Target price")} type="number" min="0.000001" max="1000000000" step="any" required value={alertPrice} onChange={e => setAlertPrice(e.target.value)} /></label>
                  <select aria-label={t("通貨", "Currency")} value={alertCurrency} onChange={e => setAlertCurrency(e.target.value)}><option>USD</option><option>KRW</option><option>JPY</option><option>CAD</option><option>EUR</option><option>GBP</option></select>
                  <select aria-label={t("通知条件", "Alert condition")} value={alertDirection} onChange={e => setAlertDirection(e.target.value as "above" | "below")}><option value="above">{t("以上になったら", "At or above")}</option><option value="below">{t("以下になったら", "At or below")}</option></select>
                  <button type="submit">{t("保存", "Save")}</button><button type="button" onClick={() => setAlertTicker("")}>{t("閉じる", "Close")}</button>
                </form>}
                {alerts.filter(a => a.ticker === ticker).map(a => <div className={styles.savedAlert} key={a.direction}><span>{number(a.price)} {a.currency} {a.direction === "above" ? t("以上", "or higher") : t("以下", "or lower")} · {t("通知未稼働", "Not live")}</span><button disabled={!editable} onClick={() => update(current => ({ ...current, alerts: (current.alerts ?? []).filter(v => !(v.ticker === ticker && v.direction === a.direction)) }))}>{t("解除", "Remove")}</button></div>)}
                {ticker === "SKHY" ? <a href="https://www.tradingview.com/symbols/KRX-000660/" target="_blank" rel="noreferrer">SK hynix · TradingView ↗</a> : <TradingViewChart ticker={ticker} exchange={item?.exchange ?? ""} lang={lang} />}
              </section>}
            </li>;
          })}</ul>
          <div className={styles.attribution}>{Object.keys(displayedQuotes).length > 0 ? <>Source: <a href="https://twelvedata.com" target="_blank" rel="noopener">Twelve Data</a></> : <span>{t("株価・当日チャートはTwelve Data接続後に表示します", "Prices and intraday charts will appear once Twelve Data is connected")}</span>}</div>
        </div>

      </> : <div className={styles.empty}><span aria-hidden="true" className={styles.emptyStar}>☆</span><h2>{t("いつもの銘柄を、ひとつの画面に。", "Your stocks, together.")}</h2><p>{t("上の検索欄から追加できます", "Add a stock using the search above")}</p></div>}
      <footer className={styles.footer}><span className={styles.syncStatus} role="status">{status === "synced" ? t("✓ 同期済み", "✓ Synced") : status === "saving" ? t("保存中…", "Saving…") : status === "loading" ? t("保存先を確認中…", "Checking sync…") : status === "guest" ? <Link href="/research/account">{t("ログインして端末間で同期", "Sign in to sync devices")}</Link> : status === "conflict" ? t("別の端末で更新されています。変更内容を控えてから再読み込みしてください。", "Updated on another device. Keep a copy of your edits before reloading.") : <>{t("同期できていません", "Not synced")} <button onClick={retry}>{t("再試行", "Retry")}</button></>}{canImport && <button onClick={importLocal}>{t("この端末のお気に入りを取り込む", "Import this device’s favorites")}</button>}</span><Link href="/research/stocks">{t("銘柄検索", "Stock search")} →</Link></footer>
    </div>
  </ResearchToolShell>;
}
