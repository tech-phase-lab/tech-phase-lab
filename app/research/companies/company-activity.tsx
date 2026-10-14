"use client";

import { useEffect, useRef, useState, useId } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { officialNewsDisplay, shownInLanguage } from "@/lib/research/news-presentation";
import { analystNewsDisplay } from "@/lib/research/analyst-news";
import { officialTime } from "@/lib/research/news-time";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import { createWatchTracker } from "@/lib/research/watch-new-items";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import NewsStory from "../news/news-story";
import styles from "./company-activity.module.css";
import DeepAnalysisPanel from "../deep-analysis-panel";

type Tag = "flash" | "analyst" | "news";
type Row = {
  id: string; at: string; kind: string; observedAt?: string; tag: Tag;
  label?: string; title: string; body?: string; wire?: CompanyWireItem;
};

const jst = (options: Intl.DateTimeFormatOptions, value: string | number | Date, locale = "en-GB") =>
  new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", hourCycle: "h23", ...options }).format(new Date(value));
const clock = (at: string) => jst({ hour: "2-digit", minute: "2-digit" }, at);
const dayKey = (at: string | number) => jst({ year: "numeric", month: "numeric", day: "numeric" }, at);
/** Time column: today shows HH:mm, an earlier day shows its date over the time. A date-only source shows just the date. */
function timeCell(row: Row) {
  if (row.kind === "date") { const [, month, day] = row.at.split("-"); return <time dateTime={row.at}>{Number(month)}/{Number(day)}</time>; }
  const today = dayKey(row.at) === dayKey(Date.now());
  return <time dateTime={row.at}>{!today && <span>{jst({ month: "numeric", day: "numeric" }, row.at)}</span>}{clock(row.at)}</time>;
}

// Reads the existing public feed only; collection, translation and publication
// rules remain owned by the news pipeline. This is a recent window, not history.
export default function CompanyActivity({ ticker, lang }: { ticker: string; lang: Language }) {
  const [data, setData] = useState<GeneralNewsFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const ja = lang === "ja";
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  // `freshCount` drives the blinking dot and badge (cleared on opening);
  // `unread` keeps the NEW marks until the panel is closed again.
  const [freshCount, setFreshCount] = useState(0);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const tracker = useRef(createWatchTracker());
  const wireTracker = useRef(createWatchTracker());
  const bodyId = useId();
  const markFresh = (ids: string[]) => {
    if (!ids.length) return;
    setUnread(previous => new Set([...previous, ...ids]));
    if (!openRef.current) setFreshCount(count => count + ids.length);
  };
  useEffect(() => {
    const poller = createNewsPoller({
      push: true,
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw new Error("unavailable");
        return availableNewsPayload(await response.json());
      },
      onSuccess: feed => {
        const entries = [
          ...(feed.officialUpdates ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({id:`official-${item.id}`, at:officialTime(item).at})),
          ...(feed.analystUpdates ?? []).filter(item => item.ticker === ticker).map(item => ({id:`analyst-${item.id}`, at:item.publishedAt})),
          ...feed.items.filter(item => item.tickers.includes(ticker)).map(item => ({id:`news-${item.id}`, at:item.publishedAt})),
        ];
        markFresh(tracker.current(entries).map(entry => entry.id));
        setData(feed); setFailed(false); setCheckedAt(new Date().toISOString());
      },
      onFailure: () => { setFailed(true); },
    });
    poller.start(0);
    const stop = observePageActivity(() => { setPaused(false); poller.resume(); }, () => { setPaused(true); poller.pause(); });
    return () => { stop(); poller.stop(); };
  }, [attempt, ticker]);
  const [wire, setWire] = useState<CompanyWireItem[]>([]);
  useEffect(() => {
    // Wire headlines are a separate, lower-trust lane: a failure here never
    // affects the verified list.
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/research/company-wire", { cache: "no-store" });
        if (!response.ok) return;
        const items = parseCompanyWire(await response.json()).items[ticker] ?? [];
        if (!alive) return;
        markFresh(wireTracker.current(items.map(item => ({ id: `wire-${item.id}`, at: item.publishedAt }))).map(entry => entry.id));
        setWire(items);
      } catch { /* keep the previous list */ }
    };
    const stop = observePageActivity(() => { void load(); timer ??= setInterval(load, 60_000); }, () => { clearInterval(timer); timer = undefined; });
    void load(); timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); stop(); };
  }, [ticker]);
  const wireLabel = (item: CompanyWireItem) => `${item.origin === "wire" ? (ja ? "企業・配信会社" : "Company / wire") : item.origin === "third-party" ? (ja ? "第三者" : "Third party") : (ja ? "発信元不明" : "Source unknown")}${item.publisher ? ` · ${item.publisher}` : ""}`;
  const wireRows = wire.filter(item => !ja || item.titleJa);
  const rows: Row[] = [
    ...(data?.officialUpdates ?? []).filter(item => item.tickers.includes(ticker) && shownInLanguage(item, lang)).map(item => {
      const display = officialNewsDisplay(item, lang, data?.resultBriefs);
      return { id: `official-${item.id}`, observedAt: item.observedAt, tag: (item.brief || /^X\b/.test(item.publisher) ? "flash" : "news") as Tag, ...display, ...officialTime(item) };
    }),
    ...(data?.analystUpdates ?? []).filter(item => item.ticker === ticker).map(item => ({ id: `analyst-${item.id}`, observedAt: item.observedAt, tag: "analyst" as Tag, ...analystNewsDisplay(item, lang), at: item.publishedAt, kind: "published" })),
    ...(data?.items ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({ id: `news-${item.id}`, observedAt: item.observedAt, tag: "news" as Tag, label: ja ? "企業ニュース" : "Company news", title: (ja ? item.summaryJa : item.summaryEn) ?? "", body: ja ? item.impactJa : item.impactEn, at: item.publishedAt, kind: "published" })),
    ...wireRows.map(item => ({ id: `wire-${item.id}`, tag: "news" as Tag, title: (ja ? item.titleJa : item.titleEn) ?? "", at: item.publishedAt, kind: "published", wire: item })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const tagText: Record<Tag, string> = ja ? { flash: "速報", analyst: "アナリスト", news: "ニュース" } : { flash: "Flash", analyst: "Analyst", news: "News" };
  const newest = rows[0];
  const hasFresh = freshCount > 0 && !open;
  const status = hasFresh ? (ja ? "新着あり" : "New") : failed ? (ja ? "再接続中" : "Reconnecting") : paused ? (ja ? "一時停止" : "Paused") : data ? (ja ? "自動更新" : "Auto-updating") : (ja ? "接続中" : "Connecting");
  const toggle = () => {
    const next = !open;
    openRef.current = next;
    setOpen(next);
    setFreshCount(0);              // opening or closing: blink and badge go
    if (!next) setUnread(new Set()); // closing clears the NEW marks
  };
  // A time the source never stated is never shown as a publication time.
  const detected = (row: Row, locale: boolean) => row.kind === "observed" ? (locale ? "発表時刻は不明（取得時刻を表示）" : "Publication time unknown (showing when found)")
    : row.observedAt ? `${locale ? "取得" : "Detected"} ${clock(row.observedAt)}` : "";
  const item = (row: Row) => <article key={row.id} className={`${styles.item} ${unread.has(row.id) ? styles.unread : ""}`}>
    <span className={styles.when}>{timeCell(row)}</span><span className={styles.node} aria-hidden="true"/>
    <div className={styles.entry}>
      <div className={styles.meta}><span className={`${styles.tag} ${styles[row.tag]}`}>{tagText[row.tag]}</span>{unread.has(row.id) && <span className={styles.newMark}>NEW</span>}</div>
      {row.wire
        ? <><p className={styles.headline} lang={lang}><a href={row.wire.url} target="_blank" rel="noopener noreferrer nofollow">{row.title}</a></p><p className={styles.src}>{wireLabel(row.wire)}</p></>
        : <NewsStory lang={lang} label={row.label ?? ""} title={row.title} body={row.body} publication={detected(row, ja)}/>}
    </div>
  </article>;
  return <><DeepAnalysisPanel lang={lang} ticker={ticker} kind="earnings" />
  <section className={`${styles.rt} ${open ? styles.open : ""} ${hasFresh ? styles.fresh : ""}`} aria-label={ja?'銘柄監視':'Company monitor'}>
    <h2 className={styles.rtTitle}><button type="button" className={styles.head} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
      <span className={styles.ttl}><svg className={styles.chev} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4l6 6-6 6"/></svg>{ja ? 'リアルタイム監視' : 'Live monitor'}</span>
      <span className={styles.state} data-failed={failed}>{hasFresh && <span className={styles.badge}>{ja ? "新着" : "New"} {freshCount > 9 ? "9+" : freshCount}</span>}<span>{status}</span><i className={styles.dot} data-live={!!data && !failed && !paused} aria-hidden="true"/></span>
      {!open && <span className={styles.peek}>{newest ? <>{newest.kind === "date" ? <time>{newest.at.slice(5).replace("-", "/")}</time> : <time>{clock(newest.at)}</time>}<span>{newest.title}</span></> : <span>{data ? (ja ? "現在の配信データ内に該当銘柄の記事はありません。" : "No matching articles in the current feed window.") : (ja ? "配信済み記事を読み込んでいます…" : "Loading published updates…")}</span>}</span>}
    </button></h2>
    <div id={bodyId} hidden={!open}>
      {failed && <p className={styles.problem} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{data && (ja ? " 前回取得した記事を表示しています。" : " Showing previously loaded articles.")} <button onClick={() => setAttempt(value => value + 1)}>{ja ? "再試行" : "Retry"}</button></p>}
      {!data && !failed && <p className={styles.problem} role="status">{ja ? "配信済み記事を読み込んでいます…" : "Loading published updates…"}</p>}
      {data && !rows.length && <p className={styles.problem}>{ja ? "現在の配信データ内に該当銘柄の記事はありません。" : "No matching articles in the current feed window."}</p>}
      {!!rows.length && <div className={styles.rule}/>}
      {!!rows.length && <div className={styles.timeline}>{rows.slice(0, 8).map(item)}</div>}
      {rows.length > 8 && <details className={styles.more}><summary>{ja ? `ほか${rows.length - 8}件を見る` : `Show ${rows.length - 8} more`}</summary><div className={styles.timeline}>{rows.slice(8).map(item)}</div></details>}
      {!!wireRows.length && <p className={styles.fine}>{ja ? "「企業・配信会社」「第三者」の表示がある記事は見出しのみで、本文は確認していません。見出しを押すと元の記事へ移動します。" : "Items labelled company / wire or third party are headlines only; article text is not checked. Headlines open the original."}</p>}
      <div className={styles.rule}/>
      <div className={styles.foot}>
        <button type="button" className={styles.bell} aria-disabled="true" aria-label={ja ? "この銘柄の速報を通知する(PRO・準備中)" : "Notify me about this stock (PRO, coming soon)"}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2.3 2.3 0 0 0 2.3-2.3H9.7A2.3 2.3 0 0 0 12 22zm6.6-6.4V11a6.6 6.6 0 0 0-5.1-6.4V3.9a1.5 1.5 0 0 0-3 0v.7A6.6 6.6 0 0 0 5.4 11v4.6L3.6 17.4V19h16.8v-1.6z"/></svg>
          {ja ? "この銘柄の速報を通知する" : "Notify me about this stock"}<small>PRO</small></button>
        <span>{checkedAt ? `${ja ? "更新" : "Updated"} ${clock(checkedAt)} JST` : ""}</span>
      </div>
      {data && <p className={styles.fine}>{ja ? "配信済み情報を自動確認。未取得の情報・全期間の履歴は含みません。" : "Auto-checking published updates; excludes uncollected information and older history."}</p>}
    </div>
  </section></>;
}
