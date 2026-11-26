"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed, type InitialNewsSnapshot } from "@/lib/research/general-news";
import { listedOfficialNews, listedOriginalPreviews } from "@/lib/research/home-today";
import { officialNewsDisplay } from "@/lib/research/news-presentation";
import { marketNewsBody, marketNewsDisplay } from "@/lib/research/market-news-display";
import { clockTime, lateDetection, officialTime, recentPublication } from "@/lib/research/news-time";
import { createNewsPoller, NEWS_POLL_INTERVAL_MS } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import { publishWire, serverWireSnapshot, subscribeWire, wireSnapshot } from "@/lib/research/wire-store";
import { parseCompanyWire } from "@/lib/research/company-wire";
import { tickerLabel, wireStories } from "@/lib/research/wire-stories";
import { homeStockStories } from "@/lib/research/home-stock-news";
import Link from "next/link";
import { dayKey, dayLabel, pageWindow, withDayDividers } from "@/lib/research/news-day";
import { displayDateTime } from "@/lib/research/display-time";
import styles from "./general-news.module.css";

import { takeNewsStartup } from "@/lib/research/news-startup";
import { publishNews } from "@/lib/research/news-snapshot";
import { forgetLastView, memberMarked, readLastView, topicsSubset, writeLastView } from "@/lib/research/member-last-view";
import FeedPagination, { turnPageInPlace } from "./feed-pagination";
import TimelineRow from "./timeline-row";
import NewsStory from "./news-story";
import OriginalPreviewCard from "./original-preview-card";
import TopicsList from "./topics-list";
/** Stories on the home list: five pages of five. */
const HOME_STORIES = 25;
const UPDATE_BLINK_MS = 900;
let snapshot: { data: GeneralNewsFeed; at: string; time: number } | null = null;
const recent = () => snapshot && Date.now() - snapshot.time < 120_000 ? snapshot : null;
let lastFailedAt = 0;
/** The list's first check takes over the request warmNews already started instead of sending a second one alongside it (Nov 19). */
let warming: Promise<GeneralNewsFeed> | null = null;
function initialSnapshot(initialNews?: InitialNewsSnapshot | null) {
  const cached = recent();
  if (!initialNews || initialNews.checkedAt <= lastFailedAt || Date.now() - initialNews.checkedAt >= 120_000
    || (cached && cached.time >= initialNews.checkedAt)) return cached;
  return { data: initialNews.data, time: initialNews.checkedAt, at: new Date(initialNews.checkedAt).toISOString() };
}

/** Starts the feed as soon as the home page is on screen, so the top strip has its headlines at once instead of waiting for the news list below
 * (which is drawn a moment later). The list then adopts this snapshot rather than asking again (owner, Oct 29: the strip appeared empty first). */
export function warmNews() {
  if (typeof window === "undefined" || recent() || warming) return;
  const request = (async () => {
    const started = takeNewsStartup();
    let payload: GeneralNewsFeed;
    if (started) { const result = await started; if (result.error) throw new Error("unavailable"); payload = availableNewsPayload(result.data); }
    else {
      const response = await fetch("/api/research/news", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("unavailable");
      payload = availableNewsPayload(await response.json());
    }
    snapshot = { data: payload, at: new Date().toISOString(), time: Date.now() };
    publishNews(payload);
    return payload;
  })();
  warming = request;
  request.catch(() => { /* the list asks again when it appears */ }).finally(() => { if (warming === request) warming = null; });
}

export default function GeneralNewsPanel({ lang, officialOnly = false, generalOnly = false, stockNews = false, initialNews, keepPlan }: { lang: Language; officialOnly?: boolean; generalOnly?: boolean; /** 注目トピック: "pro" once the membership check confirmed PRO, "none" once it said otherwise */ keepPlan?: "pro" | "none"; /** The home list: Stock News API stories (owner, Nov 15). */ stockNews?: boolean; initialNews?: InitialNewsSnapshot | null }) {
  const [fetchedData, setData] = useState<GeneralNewsFeed | null>(() => initialSnapshot(initialNews)?.data ?? null);
  const [failed, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [fetchedAt, setReceivedAt] = useState<string | null>(() => initialSnapshot(initialNews)?.at ?? null);
  // Streamed server data can arrive after this panel has already mounted.
  // Use whichever verified snapshot is newer; never wait for another poll.
  const seed = initialSnapshot(initialNews);
  const useSeed = !!seed && seed.time > (fetchedAt ? Date.parse(fetchedAt) : 0);
  const error = failed && !useSeed;
  const data = useSeed ? seed.data : fetchedData;
  const receivedAt = useSeed ? seed.at : fetchedAt;
  const panel = useRef<HTMLElement>(null);
  const [page, setPage] = useState(1);
  // Company headlines join the list, as they do on 速報 and in the top strip (owner, Oct 17: this list alone did not move).
  const wire = useSyncExternalStore(subscribeWire, wireSnapshot, serverWireSnapshot);
  // 注目トピック (owner, Nov 15): the page has no top band to fetch the company headlines, so it asks for them itself, each time the
  // news feed is checked (about every five seconds), the way the home band does.
  const [wireAt, setWireAt] = useState<string | null>(null);
  const wireChecked = useRef(false);
  useEffect(() => {
    if (!generalOnly) return;
    let alive = true;
    const started = Date.now();
    void (async () => {
      try {
        const response = await fetch("/api/research/company-wire", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (response.ok) { const items = parseCompanyWire(await response.json()).items; if (alive) publishWire(items); }
      } catch { /* keep the previous list */ }
      // Owner, Nov 26: the dot beside 自動で更新中 blinks while this check runs, for at least one blink (UPDATE_BLINK_MS) so it is seen.
      if (wireChecked.current && Date.now() - started < UPDATE_BLINK_MS) await new Promise(done => setTimeout(done, UPDATE_BLINK_MS - (Date.now() - started)));
      wireChecked.current = true;
      if (alive) setWireAt(new Date().toISOString());
    })();
    return () => { alive = false; };
  }, [generalOnly, receivedAt]);
  // Checking: the company headlines were last asked for before the news feed's latest check (or never).
  const updating = generalOnly && (!wireAt || (!!receivedAt && Date.parse(wireAt) < Date.parse(receivedAt)));
  // 注目トピック: a PRO member's last view on this device (lib/research/member-last-view.ts), shown once the topics screen's membership
  // check confirmed PRO (`keepPlan`), then refreshed; forgotten once the check says otherwise.
  const keepAs = useRef(keepPlan);
  const keptShown = useRef(false);
  useEffect(() => {
    keepAs.current = keepPlan;
    if (!generalOnly) return;
    if (keepPlan === "none") { forgetLastView("topics"); return; }
    if (keepPlan !== "pro" || keptShown.current || initialNews) return;
    keptShown.current = true;
    const kept = readLastView<GeneralNewsFeed>("topics");
    if (!kept) return;
    // Read once the check answered (reading it during render would not match the server's page).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(old => old ?? kept.data); setReceivedAt(old => old ?? new Date(kept.at).toISOString());
  }, [keepPlan, generalOnly, initialNews]);
  // Under a remembered PRO / owner mark the server's FREE view is hidden (topics-list.tsx): the page reads its own feed at once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (generalOnly && initialNews && memberMarked()) setRefresh(value => value || 1);
  }, [generalOnly, initialNews]);
  useEffect(() => {
    const cached = refresh === 0 ? initialSnapshot(initialNews) : null;
    if (cached) {
      // A newer server/memory snapshot wins over an earlier bootstrap request.
      void takeNewsStartup();
      snapshot = cached;
      publishNews(cached.data);
    }
    const poller = createNewsPoller({
      push: true,
      load: async signal => {
        if (warming) { try { return await warming; } catch { /* asks itself below, as before */ } }
        const started = takeNewsStartup();
        if (started) {
          const result = await started;
          if (result.error) throw new Error("unavailable");
          return availableNewsPayload(result.data);
        }
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw new Error("unavailable");
        return availableNewsPayload(await response.json());
      },
      onSuccess: payload => {
        const at = new Date().toISOString();
        snapshot = { data: payload, at, time: Date.now() };
        setData(payload); publishNews(payload); setError(false); setReceivedAt(at);
        if (generalOnly && keepAs.current === "pro") writeLastView("topics", topicsSubset(payload));
      },
      onFailure: () => {
        // A failed check must not let a stale module snapshot reappear after remount.
        snapshot = null;
        lastFailedAt = Date.now();
        setData(null); publishNews(null); setError(true); setReceivedAt(null);
      },
    });
    poller.start(cached ? Math.max(0, NEWS_POLL_INTERVAL_MS - (Date.now() - cached.time)) : 0);
    const stopObserving = observePageActivity(() => poller.resume(), () => poller.pause());
    return () => {
      stopObserving();
      poller.stop();
    };
  }, [refresh, initialNews, generalOnly]);
  // An item with no time stated by its source is not listed: showing the time
  // it was found would pass a guess off as the publication time (owner, Oct 10).
  // The home list shows the Stock News API stories only (owner, Nov 15): never the Tech Alerts (ハイテク速報) items, which are another
  // outlet, not even while no Stock News story is available yet.
  const stockOnly = stockNews && !officialOnly && !generalOnly;
  const stockStories = stockOnly ? homeStockStories(wire, lang) : [];
  const official = listedOfficialNews(data, lang);
  const news = officialOnly || stockOnly ? [] : [...data?.items ?? []].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const market = officialOnly || generalOnly || stockOnly ? [] : data?.marketUpdates ?? [];
  // Analyst ratings and target changes live on the price target page only (owner, Oct 7).
  // Test publications appear only once they have a checked bilingual summary;
  // untranslated originals and metadata-only notices are not listed.
  const originalPreview = officialOnly || generalOnly || stockOnly ? [] : listedOriginalPreviews(data);
  const updates = generalOnly ? [] : [
    ...originalPreview.map(item => ({ kind: "original-preview" as const, item, at: item.previewPublishedAt })),
    // Sort by the time the card shows, so the list reads newest first (owner, Oct 9).
    ...(stockOnly ? [] : official).map(item => { const time = officialTime(item), shown = clockTime(time.at, time.kind, item.observedAt);
      return { kind: "official" as const, item, publication: { ...shown, dated: time.kind }, at: shown.kind === "date" ? `${shown.at}T00:00:00Z` : shown.at }; }),
    ...market.map(item => ({ kind: "market" as const, item, at: item.publishedAt })),
    ...(officialOnly || generalOnly ? [] : (stockOnly ? stockStories : wireStories(wire, lang)).map(story => ({ kind: "wire" as const, story, at: story.at }))),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // The home list shows five stories per page, five pages at most; the whole list is on the Top Topics page (owner, Nov 5).
  const { pages, current, start, end } = pageWindow(updates.length + news.length, page, generalOnly ? Infinity : HOME_STORIES);
  const visibleUpdates = updates.slice(start, end);
  const visibleNews = news.slice(Math.max(0, start - updates.length), Math.max(0, end - updates.length));
  const format = (value: string) => displayDateTime(value, lang);
  // A glowing dot only for what was published within the hour and found promptly (same rule as the top band).
  const receivedMs = receivedAt ? Date.parse(receivedAt) : 0;
  const isFresh = (at: string, kind: string, observedAt?: string) => !!receivedAt && recentPublication(at, kind, Date.parse(receivedAt)) && !lateDetection(at, observedAt);
  const impactLabels = lang === "ja"
    ? { positive: "プラス", negative: "マイナス", mixed: "両面", neutral: "中立", uncertain: "不明" }
    : { positive: "Positive", negative: "Negative", mixed: "Mixed", neutral: "Neutral", uncertain: "Uncertain" };
  const confidenceLabels = lang === "ja" ? { high: "高", medium: "中", low: "低" } : { high: "High", medium: "Medium", low: "Low" };
  if (generalOnly) return <TopicsList serverFirst={useSeed} lang={lang} data={data} wire={wire} wireReady={!!wireAt} updating={updating} error={error} receivedAt={receivedAt ?? wireAt} page={page} onPage={setPage} />;
  return <section ref={panel} className={styles.panel} aria-label={lang === "ja" ? "ニュース一覧" : "News list"}>
    {!officialOnly && !!originalPreview.length && data?.originalPreviewWindow && <p className={styles.note}>{lang === "ja"
      ? "原文テスト掲載: 直近7日・最大30件。"
      : "Original test publications: recent 7 days, up to 30 items."}{data.originalPreviewWindow.omittedInScan > 0 && (lang === "ja"
        ? ` 今回の取得範囲でほか${data.originalPreviewWindow.omittedInScan}件は省略。`
        : ` ${data.originalPreviewWindow.omittedInScan} more items omitted from this scan.`)}{data.originalPreviewWindow.scanLimited && (lang === "ja"
          ? " 取得範囲に上限があり、全件表示ではありません。"
          : " Acquisition scan is limited; this is not a complete history.")}</p>}
    {!!visibleUpdates.length && <section aria-label={lang === "ja" ? "ニュース速報" : "News updates"}>
      <div className={styles.items}>{withDayDividers(visibleUpdates.map(update => ({ update, dayKey: update.kind === "official" ? dayKey(update.publication.at, update.publication.kind === "date" ? "date" : "time", lang) : dayKey(update.at, "time", lang) }))).map(({ entry: { update }, divider }) => {
        // One divider per day ("今日", "昨日", "11月3日"); each row then shows only its time (owner, Nov 5).
        const rule = divider ? <div className={styles.dayRow} key={`day-${divider}-${update.kind === "wire" ? update.story.id : update.item.id}`}><span>{dayLabel(divider, receivedMs, lang === "ja")}</span></div> : null;
        const row = (() => {
          if (update.kind === "original-preview") return <OriginalPreviewCard key={update.item.id} item={update.item} lang={lang} />;
          if (update.kind === "wire") {
            const story = update.story;
            return <article key={`wire-${story.id}`}><TimelineRow lang={lang} at={story.at} kind="time" fresh={isFresh(story.at, "published")}><NewsStory label={story.tickers.map(ticker => tickerLabel(ticker, lang === "ja")).join(" · ")} title={story.title} lang={lang} publication="" /></TimelineRow></article>;
          }
          if (update.kind === "market") {
            const item = update.item;
            const display = marketNewsDisplay(item, lang);
            return <article key={`market-${item.id}`}><TimelineRow lang={lang} at={item.publishedAt} kind="time" fresh={isFresh(item.publishedAt, "published", item.observedAt)}><NewsStory label={display.label} title={display.title} body={marketNewsBody(item, lang)} lang={lang} publication="" /></TimelineRow></article>;
          }
          const item = update.item;
          const publication = update.publication, display = officialNewsDisplay(item, lang, data?.resultBriefs);
          return <article key={item.id}><TimelineRow lang={lang} at={publication.at} kind={publication.kind === "date" ? "date" : "time"} fresh={isFresh(publication.at, publication.kind, item.observedAt)}><NewsStory label={display.label} title={display.title} body={display.body} fullBody={display.fullBody} concise={!item.brief && !item.newsCategory && !item.generalSource && !item.researchId} lang={lang} publication="" /></TimelineRow></article>;
        })();
        return rule ? [rule, row] : row; })}</div>
    </section>}
    {officialOnly && !data?.officialUpdates?.length && <p role="status">{error ? (lang === "ja" ? "公式発表を取得できません。" : "Official updates unavailable.") : !data ? (lang === "ja" ? "読み込み中…" : "Loading…") : (lang === "ja" ? "現在、掲載中の公式発表はありません。" : "No official updates currently listed.")}</p>}
    {!officialOnly && (visibleNews.length > 0 || (!updates.length && (!data?.enabled || !news.length))) && <><div className={styles.head}>{!generalOnly && <h2 id="general-news-title">{lang === "ja" ? "注目トピック" : "Top Topics"}</h2>}<button type="button" onClick={() => setRefresh(value => value + 1)}>{lang === "ja" ? "更新" : "Refresh"}</button></div>
    {error ? <p role="status">{lang === "ja" ? "ニュースを取得できません。しばらくしてから更新してください。" : "News is unavailable. Please refresh shortly."}</p> : !data ? <div className={styles.placeholder} aria-busy="true" aria-label={lang === "ja" ? "ニュースを取得中" : "Fetching news"} /> : !data.enabled ? <p>{lang === "ja" ? "注目トピックの配信は準備中です。" : "Top Topics are coming soon."}</p> : <>
      <p className={styles.note}>{lang === "ja" ? "日英の内容を確認した記事を掲載しています。" : "Articles are published after review of both language versions."}</p>
      {!data.items.length && <p>{lang === "ja" ? "現在、公開中の記事はありません。" : "No articles are currently published."}</p>}
      <div className={styles.items}>{visibleNews.map(item => <article key={item.id}><details className={styles.story}>
        <summary><span className={styles.tickers}>{lang === "ja" ? "企業ニュース" : "Company news"}{item.tickers.length ? ` · ${item.tickers.join(" · ")}` : ""}</span><span className={styles.headline} lang={lang}>{lang === "ja" ? item.shortTitleJa ?? item.summaryJa : item.shortTitleEn ?? item.title}</span><span className={styles.note}>{lang === "ja" ? "発表" : "Published"} {format(item.publishedAt)}</span><span className={styles.expand} aria-hidden="true">＋</span></summary>
        <div className={styles.body}><p className={styles.summary} lang={lang}>{lang === "ja" ? item.summaryJa : item.summaryEn}</p>
        <div className={styles.impact}><p><strong>{lang === "ja" ? "事業への影響" : "Business impact"}</strong><span>{impactLabels[item.impactLabel]} · {lang === "ja" ? "確信度" : "Confidence"} {confidenceLabels[item.confidence]}</span></p><p lang={lang}>{lang === "ja" ? item.impactJa : item.impactEn}</p></div></div>
      </details></article>)}</div>
      {receivedAt && <p className={styles.note}>{lang === "ja" ? "画面取得" : "Fetched"} {format(receivedAt)} · {lang === "ja" ? `約${NEWS_POLL_INTERVAL_MS / 1000}秒ごとに更新` : `Refreshes about every ${NEWS_POLL_INTERVAL_MS / 1000} seconds`}</p>}
    </>}
    </>}
    <FeedPagination page={current} pages={pages} ja={lang === "ja"} onChange={n => { turnPageInPlace(panel.current?.closest<HTMLElement>("#home-news") ?? panel.current, panel.current); setPage(n); }} />
    {!generalOnly && <Link className={styles.seeAll} href="/research/general-news">{lang === "ja" ? "注目トピックですべて見る" : "See all in Top Topics"} <span aria-hidden="true">›</span></Link>}
  </section>;
}
