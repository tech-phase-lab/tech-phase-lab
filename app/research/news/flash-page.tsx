"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { flashRows, type FlashRow } from "@/lib/research/flash-rows";
import { earningsOnlyProviders, providers } from "@/lib/research/intake";
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
/** Short company names keep each stock on one line in the coverage list. */
const shortName = (name: string) => name.split(" / ")[0].replace(/ (?:Technologies|Platforms|Networks)$/, "").replace("Applied Optoelectronics", "Applied Opto").replace("Constellation Energy", "Constellation");
const jst = (options: Intl.DateTimeFormatOptions, value: string | number | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(value));
const clock = (at: string) => jst({ hour: "2-digit", minute: "2-digit" }, at);

/** One date heading per day (owner, Oct 14): rows then show only the time. */
const dayKey = (row: FlashRow) => row.timeKind === "date" ? row.at : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(row.at));
function dayHeading(key: string, ja: boolean) {
  const date = new Date(`${key}T12:00:00+09:00`);
  const parts = new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date);
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}${ja ? `（${parts}）` : ` ${parts}`}`;
}
function timeCell(row: FlashRow, ja: boolean) {
  if (row.timeKind === "date") return <time dateTime={row.at}>{ja ? "時刻なし" : "No time"}</time>;
  return <time dateTime={row.at}>{clock(row.at)}</time>;
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
  const [page, setPage] = useState(1);
  const [seenAtLoad] = useState(() => readVisitStart());
  const tracker = useRef(createWatchTracker());
  const wireTracker = useRef(createWatchTracker());
  const list = useRef<HTMLDivElement>(null);
  const sources = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // A tap anywhere (inside the list too) or Escape closes it; only the button itself toggles it.
    const close = (event: Event) => { if (sources.current?.open && (event instanceof KeyboardEvent ? event.key === "Escape" : !(event.target as Element | null)?.closest?.("summary") || !sources.current.contains(event.target as Node))) sources.current.open = false; };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
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

  const rows = flashRows(feed, wire, lang).filter(row => (view === "all" || row.kind === "earnings"));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const marked = (row: FlashRow) => unread.has(row.id) || (seenAtLoad !== null && checkedAt > 0 && row.timeKind === "published" && isFreshItem(row.at, "published", row.observedAt, seenAtLoad, checkedAt));
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(checkedAt || undefined);
  const kindLabel = { news: ja ? "ニュース" : "News", earnings: ja ? "決算" : "Earnings" };
  const publication = (row: FlashRow) => row.timeKind === "date" ? `${ja ? "発表" : "Published"} ${row.at}`
    : `${ja ? "発表" : "Published"} ${new Date(row.at).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false })} JST`;
  const item = (row: FlashRow) => <article key={row.id} className={`${timeline.item} ${marked(row) ? timeline.unread : ""}`}>
    <span className={timeline.when}>{timeCell(row, ja)}</span><span className={timeline.node} aria-hidden="true" />
    <div className={timeline.entry}>
      <div className={timeline.meta}><span className={styles.ticker}>{row.tickers.join(" · ")}</span><span className={`${timeline.tag} ${row.kind === "earnings" ? styles.earnings : timeline.news}`}>{kindLabel[row.kind]}</span>{marked(row) && <span className={timeline.newMark}>NEW</span>}</div>
      {row.url
        ? <p className={timeline.headline} lang={lang}><a href={row.url} target="_blank" rel="noopener noreferrer nofollow">{row.title}</a></p>
        : <NewsStory lang={lang} label="" title={row.title} body={row.body} publication={publication(row)} />}
    </div>
  </article>;
  return <section className={styles.flash} aria-label={ja ? "速報" : "Alerts"}>
    <div className={styles.controls}>
      <div className={tabStyles.tabs} role="group" aria-label={ja ? "表示する速報" : "Alert filter"}>
        {(["all", "earnings"] as const).map(key => <button key={key} type="button" aria-pressed={key === view} onClick={() => { setView(key); setPage(1); }}>{key === "all" ? (ja ? "すべて" : "All") : (ja ? "決算" : "Earnings")}</button>)}
      </div>
      <details className={styles.sources} ref={sources}>
        <summary>{ja ? "ニュース取得リスト" : "Stocks covered"}<span aria-hidden="true">▾</span></summary>
        <div className={styles.sourcesPanel}>
          <h4>{ja ? `監視${providers.length}銘柄（ニュース・決算）` : `${providers.length} watched stocks (news & earnings)`}</h4>
          <ul>{providers.map(p => <li key={p.ticker}><b>{p.ticker}</b><span>{shortName(p.name)}</span></li>)}</ul>
          <h4>{ja ? `決算のみ${earningsOnlyProviders.length}銘柄` : `${earningsOnlyProviders.length} earnings-only stocks`}</h4>
          <ul>{earningsOnlyProviders.map(p => <li key={p.ticker}><b>{p.ticker}</b><span>{shortName(p.name)}</span></li>)}</ul>
        </div>
      </details>
    </div>
    <div ref={list} className={styles.panel}>
      {failed && <p className={timeline.problem} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{feed && (ja ? " 前回取得した内容を表示しています。" : " Showing previously loaded items.")}</p>}
      {!feed && !failed && <p className={timeline.problem} role="status">{ja ? "読み込んでいます…" : "Loading…"}</p>}
      {feed && !rows.length && <p className={timeline.problem}>{ja ? "現在、該当する速報はありません。" : "No matching alerts right now."}</p>}
      {!!shown.length && <div className={timeline.timeline}>{shown.flatMap((row, index) => {
        const key = dayKey(row);
        const heading: ReactNode[] = key !== dayKey(shown[index - 1] ?? row) || index === 0
          ? [<h3 key={`day-${key}`} className={styles.day}>{dayHeading(key, ja)}{key === today && <span>{ja ? "今日" : "Today"}</span>}</h3>] : [];
        return [...heading, item(row)];
      })}</div>}
    </div>
    <FeedPagination page={current} pages={pages} ja={ja} onChange={next => { setPage(next); list.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
    <p className={timeline.fine}>{ja ? "監視22銘柄のリアルタイム監視の情報と、対象37銘柄の決算の結果を、新しい順に並べています（時刻は日本時間）。銘柄ごとの情報は、監視22銘柄リストで確認できます。" : "The live monitor of the 22 watched stocks and earnings results for all 37 covered stocks, newest first."}</p>
  </section>;
}
