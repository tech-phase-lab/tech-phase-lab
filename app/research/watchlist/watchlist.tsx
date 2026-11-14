"use client";

import { useEffect, useRef, useState } from "react";
import { useFavoriteLists } from "./use-favorite-lists";
import { useWatchlistSelection } from "./use-watchlist-selection";
import { watchlistSlots, sortFavorites, addFavoriteToList, favoriteListLimit, type FavoriteQuote } from "@/lib/research/favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import WatchlistFrame from "./watchlist-frame";
import ResearchLoading from "../loading";
import ResearchToolShell from "../research-tool-shell";
import { useRouter } from "next/navigation";
import { useQuotes } from "../price/use-market";
import { detailHref } from "../price/quote-card";
import { favoriteIntradayChart } from "@/lib/research/watchlist-chart";
import AreaChart from "./area-chart";
import SwipeRow from "./swipe-row";
import { quoteForSession, type WatchlistSession } from "@/lib/research/watchlist-session";
import { quoteFreshness, freshnessLabel } from "@/lib/research/watchlist-freshness";
import { useQuoteClock } from "./use-quote-clock";
import StockLogo from "./stock-logo";
import WatchMenu from "./watch-menu";
import FlashValue from "../price/flash-value";
import EmptyWatchlist from "./empty-watchlist";
import { useWatchlistSectors } from "./use-watchlist-sectors";
import { watchlistSector } from "@/lib/research/watchlist-sector";
import styles from "./watchlist.module.css";

type Company = { ticker: string; name: string; sector?: { ja: string; en: string }; exchange?: string };
type SearchEntry = { ticker: string; name: string; exchange: string };
const fromEntry = (entry: SearchEntry): Company => ({ ticker: entry.ticker, name: entry.name, exchange: entry.exchange });
/** List names are up to nine characters (owner, Nov 13). Names saved longer before are kept as they are (the parser allows 40). */
const LIST_NAME_LIMIT = 9;
/** The first nine characters (code points), with no ellipsis. */
export const shownListName = (name: string) => Array.from(name).slice(0, LIST_NAME_LIMIT).join("");

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
  const quoteNow = useQuoteClock();
  const { lists, names, update, error, status, retry, discardPending, canImport, importLocal, editable, ready } = useFavoriteLists();
  const [listId, setListId] = useWatchlistSelection();
  const slots = watchlistSlots(lists);
  const list = slots.find(item => item.id === listId) ?? slots[0];
  const favorites = list.tickers;
  const fetchedSectors = useWatchlistSectors(favorites.filter(ticker => !watchlistSector(ticker, companies.find(item => item.ticker === ticker)?.sector)));
  const [listAction, setListAction] = useState<"rename" | null>(null);
  const [listName, setListName] = useState("");
  const listFull = favorites.length >= favoriteListLimit;
  function add(ticker: string, name?: string) {
    if (listFull || favorites.includes(ticker)) return false;
    let added = false;
    const saved = update(current => {
      const next = addFavoriteToList(current, list.id, ticker, name);
      added = next !== current;
      return next;
    });
    return saved && added;
  }
  // Every 15 seconds; the server reads the provider again only while the plan's minute leaves room (lib/research/quote-refresh-gate.ts).
  const { data: fetchedQuotes } = useQuotes(favorites.slice(0, 100), true, true);
  const liveQuotes: Record<string, FavoriteQuote> = fetchedQuotes ?? {};
  const router = useRouter();
  const [sessionView, setSessionView] = useState<WatchlistSession>("auto");
  const [revealed, setRevealed] = useState("");
  function remove(ticker: string) {
    if (!editable || !window.confirm(lang === "ja" ? `${ticker}をこのリストから削除しますか？` : `Remove ${ticker} from this list?`)) return false;
    return update(current => ({ ...current, lists: current.lists.map(item => item.id === list.id ? { ...item, tickers: item.tickers.filter(value => value !== ticker) } : item) }));
  }
  const [sort, setSort] = useState("saved");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Company[]>([]);
  const [known, setKnown] = useState<Record<string, Company>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
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
  const displayedQuotes: Record<string, FavoriteQuote> = {};
  for (const ticker of favorites) {
    const quote = quoteForSession(liveQuotes[ticker] ?? quotes[ticker], ticker, sessionView);
    if (quote && quoteFreshness(quote, quoteNow) !== "invalid") displayedQuotes[ticker] = quote;
  }
  const quoteSessions = [...new Set(Object.values(displayedQuotes).map(quote => quote.session))];
  const sharedSession = sessionView !== "auto" ? sessionView : quoteSessions.length === 1 ? quoteSessions[0] : null;
  const stateLabels = { regular: t("取引中", "Market open"), pre: t("プレ", "Pre-market"), post: t("時間外", "After-hours"), closed: t("前日比", "Daily change") };
  const ordered = sortFavorites(favorites, displayedQuotes, sort);
  const fullName = (index: number) => slots[index]?.name || t(`マイリスト${index + 1}`, `My list ${index + 1}`);
  // Owner, Nov 13: names are nine characters at most and never end in "…". A name saved longer before is shown by its first nine
  // characters (the saved name is not rewritten; the next save keeps it within nine).
  const listLabel = (index: number) => shownListName(fullName(index));
  const currentName = listLabel(slots.indexOf(list));
  const nameLength = Array.from(listName).length;
  const sortOptions = [{ value: "saved", label: t("追加した順", "Date added") }, { value: "ticker", label: t("ティッカー順", "Ticker A–Z") }, { value: "gainers", label: t("上昇率順", "Top gainers") }, { value: "losers", label: t("下落率順", "Top losers") }];
  const viewOptions = [{ value: "auto", label: t("自動", "Auto") }, { value: "regular", label: t("取引中", "Market open") }, { value: "pre", label: t("プレ", "Pre-market") }, { value: "closed", label: t("前日比", "Daily change") }];
  const number = (value: number) => value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
  if (!ready && status === "loading") return <ResearchLoading />;
  return <WatchlistFrame lang={lang}><ResearchToolShell lang={lang} setLang={setLang} title={t("ウォッチリスト", "Watchlist")} description="" showHeading={false}>
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.titles}><p className={styles.eyebrow}>WATCHLIST</p><h1>{t("ウォッチリスト", "Watchlist")}</h1></div>
        <div className={styles.listPicker}>
          <WatchMenu buttonClass={styles.listButton} menuClass={styles.listMenu} label={t(`リストを選ぶ（${currentName}）`, `Choose a list (${currentName})`)} value={list.id}
            options={slots.map((item, index) => ({ value: item.id, label: listLabel(index) }))}
            onChange={id => { setListId(id); setQuery(""); setListAction(null); setRevealed(""); }}><span className={styles.listName}>{currentName}</span></WatchMenu>
          <button type="button" disabled={!editable} className={styles.renameButton} onClick={() => { setListAction(listAction ? null : "rename"); setListName(fullName(slots.indexOf(list))); }} aria-label={t("リスト名を編集", "Edit list name")} aria-expanded={!!listAction}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
          </button>
        </div>
      </header>
      {listAction && <form className={styles.listForm} onSubmit={event => {
        event.preventDefault();
        const name = listName.trim(); if (!name || Array.from(name).length > LIST_NAME_LIMIT) return;
        if (update(current => ({ ...current, lists: watchlistSlots(current.lists).map(item => item.id === list.id ? { ...item, name } : item) }))) setListAction(null);
      }}>
        <label className={styles.nameField} data-over={nameLength > LIST_NAME_LIMIT}>
          <input autoFocus aria-label={t("リスト名", "List name")} value={listName} onChange={event => setListName(event.target.value)} maxLength={LIST_NAME_LIMIT} required />
          <span aria-live="polite">{nameLength}/{LIST_NAME_LIMIT}</span>
        </label>
        <button type="submit" className={styles.saveButton} disabled={!listName.trim() || nameLength > LIST_NAME_LIMIT}>{t("保存", "Save")}</button>
        <button type="button" className={styles.cancelButton} onClick={() => setListAction(null)}>{t("取消", "Cancel")}</button>
      </form>}
      <section className={`${styles.searchPanel} ${favorites.length === 0 ? styles.searchEmpty : ""}`} aria-label={t("銘柄を追加", "Add stock")}>
        <div className={styles.searchRow}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg><input ref={searchInput} type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("銘柄を追加：会社名・ティッカーで検索", "Add a stock: search by company name or ticker")} value={query} onChange={event => setQuery(event.target.value)} placeholder={favorites.length === 0 ? t("銘柄名・ティッカーで追加", "Add by name or ticker") : t("銘柄を追加・検索", "Find a stock to add")} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} />{query && <button className={styles.iconButton} onClick={() => { setQuery(""); searchInput.current?.focus(); }} aria-label={t("検索をクリア", "Clear search")}>×</button>}{favorites.length === 0 && !query && <button type="button" className={styles.searchPlus} aria-label={t("入力欄で銘柄を探す", "Search for a stock")} onClick={() => searchInput.current?.focus()}>＋</button>}</div>
        {query.trim() && <div className={styles.results}><div role="status" className={styles.searchStatus}>{searching ? t("検索中…", "Searching…") : searchError ? t("検索できませんでした。もう一度お試しください。", "Search unavailable. Please try again.") : !matches.length ? t("一致する銘柄がありません", "No matching stocks") : null}</div>
          <ul className={styles.choices}>{matches.map(item => <li key={item.ticker}><button disabled={!editable || listFull || favorites.includes(item.ticker)} onClick={() => { setKnown(previous => ({ ...previous, [item.ticker]: item })); if (add(item.ticker, item.name)) { setQuery(""); searchInput.current?.blur(); } }}><span><strong>{item.ticker}</strong><small>{item.name}</small></span><span className={styles.choiceAction}>{favorites.includes(item.ticker) ? t("追加済み", "Added") : listFull ? t("上限", "List full") : t("＋追加", "+ Add")}</span></button></li>)}</ul>
        </div>}
        {listFull && <p className={styles.searchStatus} role="status">{t("このリストは100銘柄までです。削除するか、別のリストに追加してください。", "This list is full (100 stocks). Remove a stock or add it to another list.")}</p>}
      </section>
      <span className={styles.srOnly} role="status">{status === "saving" ? t("保存中…", "Saving…") : status === "loading" ? t("保存先を確認中…", "Checking sync…") : status === "synced" ? t("保存しました", "Saved") : ""}</span>
      {(status === "error" || status === "conflict") && <div className={styles.syncNotice} role="alert">
        <span>{status === "conflict" ? t("保存先の内容が変わったため、未保存の変更を保留しています。", "Your saved list changed. Unsaved edits are on hold.") : t("同期できていません", "Not synced")}</span>
        {status === "error" && <button onClick={retry}>{t("再試行", "Retry")}</button>}
        {status === "conflict" && <button onClick={() => { if (window.confirm(t("この端末の未保存の変更を取り消し、保存済みの内容に戻しますか？", "Discard this tab’s unsaved edits and load the saved list?"))) discardPending(); }}>{t("保存済みの内容に戻す", "Use saved list")}</button>}
      </div>}
      {canImport && <div className={styles.syncNotice}><button onClick={importLocal}>{t("この端末のウォッチリストを取り込む", "Import this device’s watchlist")}</button></div>}
      {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
      {!ready ? <div className={styles.loading} role="status">{t("保存済みのリストを確認できません", "Your saved watchlist is unavailable")}</div> : favorites.length > 0 ? <>
        <div className={styles.toolbar}>
          <WatchMenu buttonClass={styles.textButton} label={t("並び順", "Sort order")} value={sort} options={sortOptions} onChange={setSort}>{sortOptions.find(option => option.value === sort)?.label}</WatchMenu>
          <WatchMenu buttonClass={styles.textButton} menuClass={styles.viewMenu} label={t("取引時間帯の表示", "Market session view")} value={sessionView} options={viewOptions} onChange={value => { setSessionView(value as WatchlistSession); setRevealed(""); }}>{t("表示", "View")} {viewOptions.find(option => option.value === sessionView)?.label}</WatchMenu>
          <span className={styles.marketState}><i aria-hidden="true" />{sharedSession ? stateLabels[sharedSession] : t("現在", "Now")}{t(" ・ ", " · ")}<CurrentTime /> JST</span>
        </div>
        <ul className={styles.quoteRows} data-watchlist-rows>{ordered.map(ticker => {
          const item = companies.find(entry => entry.ticker === ticker) ?? known[ticker];
          const sector = (watchlistSector(ticker, item?.sector) ?? fetchedSectors[ticker])?.[lang];
          const sectorSource = !watchlistSector(ticker, item?.sector) && fetchedSectors[ticker] ? `SEC SIC ${fetchedSectors[ticker].sic}: ${fetchedSectors[ticker].description}` : undefined;
          const quote = displayedQuotes[ticker] ?? null;
          const freshness = quote ? quoteFreshness(quote, quoteNow) : "unknown";
          const oldLabel = freshness === "stale" || freshness === "delayed" ? freshnessLabel(freshness, lang) : "";
          const extendedTag = quote?.session === "pre" ? t("プレ", "Pre") : quote?.session === "post" ? t("時間外", "After") : "";
          const chart = quote ? favoriteIntradayChart(quote) : null;
          // The dot sits on the latest price: the quote, when it is newer than the last 5-minute bar.
          const values = chart && quote && Date.parse(quote.asOf) > Date.parse(chart.end) && quote.price !== chart.values[chart.values.length - 1] ? [...chart.values, quote.price] : chart?.values;
          const direction = quote?.percentChange == null ? "flat" : quote.percentChange > 0 ? "up" : quote.percentChange < 0 ? "down" : "flat";
          return <li key={ticker} className={styles.quoteRow}>
            <SwipeRow key={`${list.id}:${ticker}`} open={revealed === ticker} onOpenChange={open => setRevealed(open ? ticker : "")} onRemove={() => remove(ticker)} disabled={!editable} removeLabel={t(`${ticker}をこのリストから削除`, `Remove ${ticker} from this list`)}>
            <button className={styles.rowMain} onClick={() => router.push(detailHref(ticker, "watchlist"))}>
              <StockLogo ticker={ticker} />
              <span className={styles.company}><strong>{item?.name ?? names[ticker] ?? ticker}</strong><span className={styles.tickerLine}>{ticker}{sector && <span className={styles.sector} title={sectorSource}>{sector}</span>}</span></span>
              {chart && values ? <AreaChart className={styles.chart} values={values} reference={chart.reference} label={t(`${ticker}の当日の値動き`, `${ticker} intraday trend`)} /> : <span className={styles.noChart} aria-label={t("当日チャート未取得", "Intraday chart unavailable")}>—</span>}
              <span className={styles.price}>
                <FlashValue scope={`${list.id}:${ticker}:${sessionView}`} value={quote?.price ?? null} className={styles.priceValue}>{quote ? number(quote.price) : "—"}</FlashValue>
                <span className={styles.rate} data-direction={direction}>
                  {oldLabel ? <small className={styles.oldLabel}>{oldLabel}</small> : extendedTag && <small className={styles.sessionTag}>{extendedTag}</small>}
                  {quote?.percentChange == null ? "—" : <>{direction === "up" ? "▲" : direction === "down" ? "▼" : ""}{direction !== "flat" && " "}{percent(quote.percentChange)}</>}
                </span>
              </span>
            </button>
            </SwipeRow>
          </li>;
        })}</ul>
        <div className={styles.attribution}>{Object.keys(displayedQuotes).length > 0 ? <>{t("提供：", "Data: ")}<a href="https://twelvedata.com" target="_blank" rel="noopener">Twelve Data</a></> : <span>{t("提供予定：Twelve Data", "Planned data provider: Twelve Data")}</span>}</div>
      </> : <EmptyWatchlist lang={lang} disabled={!editable || listFull} listName={currentName} onAdd={ticker => { add(ticker); }} />}
    </div>
  </ResearchToolShell></WatchlistFrame>;
}
