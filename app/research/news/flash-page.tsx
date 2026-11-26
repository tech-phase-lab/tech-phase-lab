"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { companyWireDelay, parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { flashRows, WATCH_TICKERS, type FlashRow } from "@/lib/research/flash-rows";
import { freeFlashRows } from "@/lib/research/free-flash";
import Link from "next/link";
import { useMemberDisplay, useMemberSettled, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import { providers } from "@/lib/research/intake";
import { isFreshItem } from "@/lib/research/company-freshness";
import { createNewsPoller, NEWS_POLL_INTERVAL_MS } from "@/lib/research/news-poller";
import { createWatchTracker } from "@/lib/research/watch-new-items";
import { observePageActivity } from "@/lib/research/page-activity";
import { readVisitStart } from "../use-alerts-unread";
import { forgetLastView, readLastView, writeLastView } from "@/lib/research/member-last-view";
import timeline from "../companies/company-activity.module.css";
import tabStyles from "./news-feed.module.css";
import styles from "./flash-page.module.css";
import FeedPagination, { turnPageInPlace } from "./feed-pagination";
import { displayClock, displayDayKey, zoneLabel } from "@/lib/research/display-time";
import NewsStory from "./news-story";

const PAGE = 20;
/** Short company names keep each stock on one line in the coverage list. */
const shortName = (name: string) => name.split(" / ")[0].replace(/ (?:Technologies|Platforms|Networks)$/, "").replace("Applied Optoelectronics", "Applied Opto").replace("Constellation Energy", "Constellation");
/** One date heading per day (owner, Oct 14): rows then show only the time. Days and times are
 * Japan time in Japanese and U.S. Eastern in English (owner, Nov 17). */
export const flashDayKey = (row: Pick<FlashRow, "at" | "timeKind">, lang: Language) => row.timeKind === "date" ? row.at : displayDayKey(row.at, lang);
export function dayHeading(key: string, ja: boolean) {
  const weekday = new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(`${key}T12:00:00Z`));
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}${ja ? `（${weekday}）` : ` ${weekday}`}`;
}
function timeCell(row: FlashRow, lang: Language) {
  // A source that states only the day sits under that day's heading with no clock (owner, Oct 15: "時刻なし" removed).
  if (row.timeKind === "date") return null;
  // A source that states no time shows when it was first seen, labelled 取得 / Found as on the company timeline: a found
  // time is never shown as if it were the publication time (owner, Oct 10; label added Nov 26).
  if (row.timeKind === "found") return <time dateTime={row.at}><span className={timeline.found}>{lang === "ja" ? "取得" : "Found"}</span>{displayClock(row.at, lang)}</time>;
  return <time dateTime={row.at}>{displayClock(row.at, lang)}</time>;
}

/** The alerts the server drew into the first HTML (lib/research/news-first-paint.ts): `full` is the server's own verdict on the session. */
export type FirstAlerts = { full: boolean; feed: GeneralNewsFeed; wire: Record<string, CompanyWireItem[]> | null; checkedAt: number };

/** 速報: the watched companies' live monitor and earnings results as one
 * newest-first timeline. New rows look like the live monitor's: a mint dot
 * (no NEW label, owner 11/26), and they stay marked until the page is left (owner, Oct 14). */
export default function FlashPage({ lang, onReady, initial = null }: { lang: Language; onReady?: () => void; initial?: FirstAlerts | null }) {
  const ja = lang === "ja";
  const [feed, setFeed] = useState<GeneralNewsFeed | null>(initial?.feed ?? null);
  const [wire, setWire] = useState<Record<string, CompanyWireItem[]>>(initial?.wire ?? {});
  const [failed, setFailed] = useState(false);
  // The server's read time, so the first paint and the hydrated page cut the FREE window at the same instant.
  const [checkedAt, setCheckedAt] = useState(initial?.checkedAt ?? 0);
  // The page is shown once the company headlines have answered (or a short grace period passed), so they do not slide in on top afterwards.
  const [wireSettled, setWireSettled] = useState(initial?.wire != null);
  const [wireLoaded, setWireLoaded] = useState(initial?.wire != null);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<"all" | "earnings">("all");
  const [page, setPage] = useState(1);
  const [seenAtLoad] = useState(() => readVisitStart());
  // Until PRO (or the owner) is confirmed, the page shows the FREE version: 30 minutes behind, the latest five, headlines only.
  const memberPlan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const ownerRole = useResearchOwner();
  const memberSettled = useMemberSettled();
  // Until the browser's own check answers, the server's verdict on this session (it sent the full feed only to PRO or an owner account).
  const full = (!memberSettled && initial?.full === true) || memberPlan === "pro" || ownerAccount || ownerRole;
  // A PRO member's last view on this device (lib/research/member-last-view.ts): shown the moment the page opens, then refreshed.
  useEffect(() => {
    if (initial) return;
    const kept = readLastView<{ feed: GeneralNewsFeed; wire: Record<string, CompanyWireItem[]>; checkedAt: number }>("alerts");
    if (!kept) return;
    // Read once after mount (reading it during render would not match the server's page).
    setFeed(old => old ?? kept.data.feed); setWire(old => Object.keys(old).length ? old : kept.data.wire);
    setCheckedAt(old => old || kept.data.checkedAt); setWireSettled(true); setWireLoaded(true);
  }, [initial]);
  useEffect(() => {
    if (memberSettled && !full) { forgetLastView("alerts"); return; }
    if (full && feed && wireLoaded && checkedAt) writeLastView("alerts", { feed, wire, checkedAt });
  }, [memberSettled, full, feed, wire, wireLoaded, checkedAt]);
  const tracker = useRef(createWatchTracker());
  const wireTracker = useRef(createWatchTracker());
  const list = useRef<HTMLDivElement>(null);
  const sources = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // A tap anywhere (inside the list too) or Escape closes it; only the button itself toggles it.
    // The tap is swallowed on the way in, so it never lands on whatever sits behind the list (owner, Oct 15: the TSM row opened).
    const close = (event: Event) => {
      const panel = sources.current;
      if (!panel?.open) return;
      if (event instanceof KeyboardEvent) { if (event.key === "Escape") panel.open = false; return; }
      const target = event.target as Element | null;
      if (target?.closest?.("summary") && panel.contains(target)) return;
      event.preventDefault(); event.stopPropagation(); panel.open = false;
    };
    document.addEventListener("click", close, true); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close, true); document.removeEventListener("keydown", close); };
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
    // With the server's alerts on screen they are the baseline for "new", and the next read is the regular one.
    if (initial) tracker.current(flashRows(initial.feed, {}, lang).filter(row => !row.id.startsWith("wire:")).map(row => ({ id: row.id, at: row.timeKind === "date" ? `${row.at}T00:00:00Z` : row.at })));
    poller.start(initial ? NEWS_POLL_INTERVAL_MS : 0);
    const stop = observePageActivity(() => poller.resume(), () => poller.pause());
    return () => { stop(); poller.stop(); };
  }, [lang, initial]);
  useEffect(() => {
    // Wire headlines are a lower-trust lane: a failure here never affects the rest.
    // Until the first list arrives, a failed try is repeated within seconds, not a minute later (owner, Nov 15).
    let alive = true, active = true, busy = false, loaded = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/research/company-wire", { cache: "no-store" });
        if (!response.ok) return false;
        const items = parseCompanyWire(await response.json()).items;
        if (!alive) return false;
        markFresh(wireTracker.current(Object.values(items).flat().map(item => ({ id: `wire:${item.id}`, at: item.publishedAt }))).map(row => row.id));
        setWire(items); setWireLoaded(true); setCheckedAt(Date.now());
        return true;
      } catch { return false; /* keep the previous list */ }
      finally { if (alive) setWireSettled(true); }
    };
    const run = async () => {
      if (busy) return;
      busy = true; clearTimeout(timer); timer = undefined;
      const ok = await load();
      busy = false;
      if (!alive) return;
      if (ok) { loaded = true; failures = 0; } else if (!loaded) failures += 1;
      if (active) timer = setTimeout(run, companyWireDelay(loaded, failures));
    };
    const grace = setTimeout(() => setWireSettled(true), 2_500);
    const first = initial?.wire;
    if (first) { wireTracker.current(Object.values(first).flat().map(item => ({ id: `wire:${item.id}`, at: item.publishedAt }))); loaded = true; }
    const stop = observePageActivity(() => { active = true; void run(); }, () => { active = false; clearTimeout(timer); timer = undefined; });
    if (first) timer = setTimeout(run, companyWireDelay(true, 0)); else void run();
    return () => { alive = false; clearTimeout(grace); clearTimeout(timer); stop(); };
  }, [initial]);

  // The page shell shows the shared branded loader until the first feed (or its failure) is known (owner, Oct 20).
  useEffect(() => { if ((feed || failed) && wireSettled) onReady?.(); }, [feed, failed, wireSettled, onReady]);

  const allRows = flashRows(feed, wire, lang).filter(row => (row.kind === "earnings" || row.tickers.some(ticker => WATCH_TICKERS.has(ticker))) && (view === "all" || row.kind === "earnings"));
  const rows = full ? allRows : freeFlashRows(allRows, checkedAt || Date.now());
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const marked = (row: FlashRow) => unread.has(row.id) || (seenAtLoad !== null && checkedAt > 0 && row.timeKind === "published" && isFreshItem(row.at, "published", row.observedAt, seenAtLoad, checkedAt));
  const today = displayDayKey(checkedAt || Date.now(), lang);
  const kindLabel = { news: ja ? "ニュース" : "News", earnings: ja ? "決算" : "Earnings" };
  const item = (row: FlashRow) => <article key={row.id} className={`${timeline.item} ${marked(row) ? timeline.unread : ""}`}>
    <span className={timeline.when}>{timeCell(row, lang)}</span><span className={timeline.node} aria-hidden="true" />
    <div className={timeline.entry}>
      <div className={timeline.meta}><span className={styles.ticker}>{row.tickers.join(" · ")}</span><span className={`${timeline.tag} ${row.kind === "earnings" ? styles.earnings : timeline.news}`}>{kindLabel[row.kind]}</span></div>
      {/* A long headline shows two lines and the ＋ opens the whole text, never a cut-off "…" (owner, Oct 18). The left column carries the
          time, so no 「発表 …」 line under each item (owner, Nov 25). */}
      <NewsStory lang={lang} label="" title={row.title} body={full ? row.body : undefined} publication="" capDetail />
    </div>
  </article>;
  return <section className={styles.flash} aria-label={ja ? "速報" : "Alerts"}>
    <div className={styles.controls}>
      <div className={tabStyles.tabs} role="group" aria-label={ja ? "表示する速報" : "Alert filter"}>
        {(["all", "earnings"] as const).map(key => <button key={key} type="button" aria-pressed={key === view} onClick={() => { if (list.current) list.current.style.minHeight = ""; setView(key); setPage(1); }}>{key === "all" ? (ja ? "すべて" : "All") : (ja ? "決算" : "Earnings")}</button>)}
      </div>
      <details className={styles.sources} ref={sources}>
        <summary>{ja ? "ニュース取得リスト" : "Stocks covered"}<span aria-hidden="true">▾</span></summary>
        <div className={styles.sourcesPanel}>
          <h4>{ja ? `監視${providers.length}銘柄（ニュース・決算）` : `${providers.length} watched stocks (news & earnings)`}</h4>
          <ul>{providers.map(p => <li key={p.ticker}><b>{p.ticker}</b><span>{shortName(p.name)}</span></li>)}</ul>
        </div>
      </details>
    </div>
    {!full && <p className={styles.freeNote} role="note"><b>FREE</b>{ja ? "版　30分遅延・新着5件" : " 30 min behind · latest 5"}<br /><Link href="/research#tech-phase-pro">{ja ? "PRO版は、リアルタイム・全件" : "PRO: real-time access to all updates"}</Link></p>}
    <div ref={list} className={styles.panel}>
      {failed && <p className={timeline.problem} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{feed && (ja ? " 前回取得した内容を表示しています。" : " Showing previously loaded items.")}</p>}
      {/* Company headlines still on the way: one quiet line, so the page never looks like earnings only (owner, Nov 15). */}
      {wireSettled && !wireLoaded && view === "all" && <p className={timeline.fine} role="status">{ja ? "ニュースを読み込んでいます" : "Loading news…"}</p>}
      {feed && !rows.length && <p className={timeline.problem}>{ja ? "現在、該当する速報はありません。" : "No matching alerts right now."}</p>}
      {!!shown.length && <div className={timeline.timeline}>{shown.flatMap((row, index) => {
        const key = flashDayKey(row, lang);
        const heading: ReactNode[] = key !== flashDayKey(shown[index - 1] ?? row, lang) || index === 0
          ? [<h3 key={`day-${key}`} className={styles.day}>{dayHeading(key, ja)}{key === today && <span>{ja ? "今日" : "Today"}</span>}<small>{zoneLabel(lang)}</small></h3>] : [];
        return [...heading, item(row)];
      })}</div>}
    </div>
    <FeedPagination page={current} pages={pages} ja={ja} onChange={next => { turnPageInPlace(list.current); setPage(next); }} />
  </section>;
}
