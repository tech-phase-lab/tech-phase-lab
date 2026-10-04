"use client";

import { useEffect, useRef, useState, useId } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { officialNewsDisplay } from "@/lib/research/news-presentation";
import { analystNewsDisplay } from "@/lib/research/analyst-news";
import { officialTime, shortNewsTime } from "@/lib/research/news-time";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import { createWatchTracker } from "@/lib/research/watch-new-items";
import NewsStory from "../news/news-story";
import styles from "./company-activity.module.css";

// Reads the existing public feed only; collection, translation and publication
// rules remain owned by the news pipeline. This is a recent window, not history.
export default function CompanyActivity({ ticker, lang }: { ticker: string; lang: Language }) {
  const [data, setData] = useState<GeneralNewsFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const ja = lang === "ja";
  const [open, setOpen] = useState(false);
  const [freshCount, setFreshCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const tracker = useRef(createWatchTracker());
  const bodyId = useId();
  useEffect(() => {
    const poller = createNewsPoller({
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
        const fresh = tracker.current(entries);
        if (fresh.length) { setOpen(true); setFreshCount(count => count + fresh.length); }
        setData(feed); setFailed(false); setCheckedAt(new Date().toISOString());
      },
      onFailure: () => { setFailed(true); },
    });
    poller.start(0);
    const stop = observePageActivity(() => { setPaused(false); poller.resume(); }, () => { setPaused(true); poller.pause(); });
    return () => { stop(); poller.stop(); };
  }, [attempt, ticker]);
  const rows = [
    ...(data?.officialUpdates ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({ id: `official-${item.id}`, observedAt: item.observedAt, ...officialNewsDisplay(item, lang, data?.resultBriefs), ...officialTime(item) })),
    ...(data?.analystUpdates ?? []).filter(item => item.ticker === ticker).map(item => ({ id: `analyst-${item.id}`, observedAt: item.observedAt, ...analystNewsDisplay(item, lang), at: item.publishedAt, kind: "published" })),
    ...(data?.items ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({ id: `news-${item.id}`, observedAt: item.observedAt, label: ja ? "企業ニュース" : "Company news", title: ja ? item.summaryJa : item.summaryEn, body: ja ? item.impactJa : item.impactEn, at: item.publishedAt, kind: "published" })),
  ].sort((a,b) => Date.parse(b.at)-Date.parse(a.at));
  const publication = (row: typeof rows[number]) => {
    const first = `${row.kind === "observed" ? (ja ? "取得" : "Found") : (ja ? "発表" : "Published")} ${shortNewsTime(row.at, row.kind)}`;
    return row.kind === "observed" ? first : `${first} · ${ja ? "取得" : "Detected"} ${shortNewsTime(row.observedAt, "observed")}`;
  };
  return <section className={`${styles.activity} ${styles.monitor}`} aria-label={ja?'銘柄監視':'Company monitor'}>
    <h2 className={styles.monitorTitle}><button type="button" className={styles.monitorToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen(value => !value); setFreshCount(0); }}>
      <span className={styles.titleText}><span aria-hidden="true">{open ? "▾" : "▸"}</span>{ja ? 'リアルタイム監視' : 'Live monitor'}</span>
      <span className={styles.connection} data-live={!!data && !failed && !paused} data-failed={failed}><i aria-hidden="true"/>{freshCount ? (ja ? `新着 ${freshCount}件` : `${freshCount} new`) : failed ? (ja ? '再接続中' : 'Reconnecting') : paused ? (ja ? '一時停止' : 'Paused') : data ? (ja ? '自動更新' : 'Auto-updating') : (ja ? '接続中' : 'Connecting')}</span>
    </button></h2>
    <div id={bodyId} hidden={!open}>
    {checkedAt && <p className={styles.note}>{ja?'配信確認':'Feed checked'} {new Intl.DateTimeFormat(ja?'ja-JP':'en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(checkedAt))} JST</p>}
    {failed && <p className={styles.state} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{data && (ja ? " 前回取得した記事を表示しています。" : " Showing previously loaded articles.")} <button onClick={() => setAttempt(value => value + 1)}>{ja ? "再試行" : "Retry"}</button></p>}
    {!data && !failed && <p className={styles.state} role="status">{ja ? "配信済み記事を読み込んでいます…" : "Loading published updates…"}</p>}
    {data && !rows.length && <p className={styles.state}>{ja ? "現在の配信データ内に該当銘柄の記事はありません。" : "No matching articles in the current feed window."}</p>}
    {!!rows.length && <div className={styles.list}>{rows.slice(0, 3).map(row => <article key={row.id}><NewsStory lang={lang} label={row.label} title={row.title} body={row.body} publication={publication(row)}/></article>)}</div>}
    {rows.length > 3 && <details className={styles.more}><summary>{ja ? `ほか${rows.length - 3}件を見る` : `Show ${rows.length - 3} more`}</summary>{rows.slice(3).map(row => <article key={row.id}><NewsStory lang={lang} label={row.label} title={row.title} body={row.body} publication={publication(row)}/></article>)}</details>}
    {data && <p className={styles.note}>{ja ? "配信済み情報を自動確認。未取得の情報・全期間の履歴は含みません。" : "Auto-checking published updates; excludes uncollected information and older history."}</p>}
    </div>
  </section>;
}
