"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { FLASH_TICKERS, flashRows, type FlashRow } from "@/lib/research/flash-rows";
import { isFreshItem } from "@/lib/research/company-freshness";
import { createNewsPoller } from "@/lib/research/news-poller";
import { createWatchTracker } from "@/lib/research/watch-new-items";
import { observePageActivity } from "@/lib/research/page-activity";
import { readVisitStart } from "../use-alerts-unread";
import timeline from "../companies/company-activity.module.css";
import tabStyles from "./news-feed.module.css";
import styles from "./flash-page.module.css";
import FeedPagination from "./feed-pagination";
import NewsStory from "./news-story";

const PAGE = 20;
const jst = (options: Intl.DateTimeFormatOptions, value: string | number | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(value));
const clock = (at: string) => jst({ hour: "2-digit", minute: "2-digit" }, at);
const dayKey = (at: string | number) => jst({ year: "numeric", month: "numeric", day: "numeric" }, at);

function timeCell(row: FlashRow) {
  if (row.timeKind === "date") { const [, month, day] = row.at.split("-"); return <time dateTime={row.at}>{Number(month)}/{Number(day)}</time>; }
  const today = dayKey(row.at) === dayKey(Date.now());
  return <time dateTime={row.at}>{!today && <span>{jst({ month: "numeric", day: "numeric" }, row.at)}</span>}{clock(row.at)}</time>;
}

/** 速報: the watched companies' live monitor and earnings results as one
 * newest-first timeline. New rows look like the live monitor's: a mint dot,
 * NEW, and they stay marked until the page is left (owner, Oct 14). */
export default function FlashPage({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const [feed, setFeed] = useState<GeneralNewsFeed | null>(null);
  const [wire, setWire] = useState<Record<string, CompanyWireItem[]>>({});
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<"all" | "earnings">("all");
  const [ticker, setTicker] = useState("all");
  const [page, setPage] = useState(1);
  const [seenAtLoad] = useState(() => readVisitStart());
  const tracker = useRef(createWatchTracker());
  const wireTracker = useRef(createWatchTracker());
  const list = useRef<HTMLDivElement>(null);
  const markFresh = (ids: string[]) => { if (ids.length) setUnread(previous => new Set([...previous, ...ids])); };

  useEffect(() => {
    const poller = createNewsPoller({
      push: true,
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw new Error("unavailable");
        return availableNewsPayload(await response.json());
      },
      onSuccess: payload => {
        markFresh(tracker.current(flashRows(payload, {}, lang).filter(row => !row.id.startsWith("wire:")).map(row => ({ id: row.id, at: row.timeKind === "date" ? `${row.at}T00:00:00Z` : row.at }))).map(row => row.id));
        setFeed(payload); setFailed(false); setCheckedAt(Date.now());
      },
      onFailure: () => setFailed(true),
    });
    poller.start(0);
    const stop = observePageActivity(() => poller.resume(), () => poller.pause());
    return () => { stop(); poller.stop(); };
  }, [lang]);
  useEffect(() => {
    // Wire headlines are a lower-trust lane: a failure here never affects the rest.
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/research/company-wire", { cache: "no-store" });
        if (!response.ok) return;
        const items = parseCompanyWire(await response.json()).items;
        if (!alive) return;
        markFresh(wireTracker.current(Object.values(items).flat().map(item => ({ id: `wire:${item.id}`, at: item.publishedAt }))).map(row => row.id));
        setWire(items); setCheckedAt(Date.now());
      } catch { /* keep the previous list */ }
    };
    const stop = observePageActivity(() => { void load(); timer ??= setInterval(load, 60_000); }, () => { clearInterval(timer); timer = undefined; });
    void load(); timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);

  const rows = flashRows(feed, wire, lang).filter(row => (view === "all" || row.kind === "earnings") && (ticker === "all" || row.tickers.includes(ticker)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const marked = (row: FlashRow) => unread.has(row.id) || (seenAtLoad !== null && checkedAt > 0 && row.timeKind === "published" && isFreshItem(row.at, "published", row.observedAt, seenAtLoad, checkedAt));
  const kindLabel = { news: ja ? "ニュース" : "News", earnings: ja ? "決算" : "Earnings" };
  const publication = (row: FlashRow) => row.timeKind === "date" ? `${ja ? "発表" : "Published"} ${row.at}`
    : `${ja ? "発表" : "Published"} ${new Date(row.at).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false })} JST`;
  const item = (row: FlashRow) => <article key={row.id} className={`${timeline.item} ${marked(row) ? timeline.unread : ""}`}>
    <span className={timeline.when}>{timeCell(row)}</span><span className={timeline.node} aria-hidden="true" />
    <div className={timeline.entry}>
      <div className={timeline.meta}><span className={styles.ticker}>{row.tickers.join(" · ")}</span><span className={`${timeline.tag} ${row.kind === "earnings" ? styles.earnings : timeline.news}`}>{kindLabel[row.kind]}</span>{marked(row) && <span className={timeline.newMark}>NEW</span>}</div>
      {row.url
        ? <><p className={timeline.headline} lang={lang}><a href={row.url} target="_blank" rel="noopener noreferrer nofollow">{row.title}</a></p>{row.source && <p className={timeline.src}>{row.source}</p>}</>
        : <NewsStory lang={lang} label="" title={row.title} body={row.body} publication={publication(row)} />}
    </div>
  </article>;
  return <section className={styles.flash} aria-label={ja ? "速報" : "Alerts"}>
    <div className={styles.controls}>
      <div className={tabStyles.tabs} role="group" aria-label={ja ? "表示する速報" : "Alert filter"}>
        {(["all", "earnings"] as const).map(key => <button key={key} type="button" aria-pressed={key === view} onClick={() => { setView(key); setPage(1); }}>{key === "all" ? (ja ? "すべて" : "All") : (ja ? "決算" : "Earnings")}</button>)}
      </div>
      <label className={styles.filter}><span>{ja ? "銘柄で絞る" : "Stock"}</span>
        <select value={ticker} onChange={event => { setTicker(event.target.value); setPage(1); }}>
          <option value="all">{ja ? "すべての銘柄" : "All stocks"}</option>
          {FLASH_TICKERS.map(code => <option key={code} value={code}>{code}</option>)}
        </select></label>
    </div>
    <div ref={list} className={styles.panel}>
      {failed && <p className={timeline.problem} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{feed && (ja ? " 前回取得した内容を表示しています。" : " Showing previously loaded items.")}</p>}
      {!feed && !failed && <p className={timeline.problem} role="status">{ja ? "読み込んでいます…" : "Loading…"}</p>}
      {feed && !rows.length && <p className={timeline.problem}>{ja ? "現在、該当する速報はありません。" : "No matching alerts right now."}</p>}
      {!!shown.length && <div className={timeline.timeline}>{shown.map(item)}</div>}
    </div>
    <FeedPagination page={current} pages={pages} ja={ja} onChange={next => { setPage(next); list.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
    <p className={timeline.fine}>{ja ? "監視22銘柄のリアルタイム監視の情報と、対象37銘柄の決算の結果を、新しい順に並べています。" : "The live monitor of the 22 watched stocks and earnings results for all 37 covered stocks, newest first."}</p>
  </section>;
}
