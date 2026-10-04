"use client";

import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { officialNewsDisplay } from "@/lib/research/news-presentation";
import { analystNewsDisplay } from "@/lib/research/analyst-news";
import { officialTime, shortNewsTime } from "@/lib/research/news-time";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import NewsStory from "../news/news-story";
import styles from "./company-activity.module.css";

// Reads the existing public feed only; collection, translation and publication
// rules remain owned by the news pipeline. This is a recent window, not history.
export default function CompanyActivity({ ticker, lang }: { ticker: string; lang: Language }) {
  const [data, setData] = useState<GeneralNewsFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const ja = lang === "ja";
  useEffect(() => {
    if (!open) return;
    const poller = createNewsPoller({
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw new Error("unavailable");
        return availableNewsPayload(await response.json());
      },
      onSuccess: feed => { setData(feed); setFailed(false); },
      onFailure: () => { setFailed(true); },
    });
    poller.start(0);
    const stop = observePageActivity(() => poller.resume(), () => poller.pause());
    return () => { stop(); poller.stop(); };
  }, [attempt, open]);
  const rows = [
    ...(data?.officialUpdates ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({ id: `official-${item.id}`, ...officialNewsDisplay(item, lang, data?.resultBriefs), ...officialTime(item) })),
    ...(data?.analystUpdates ?? []).filter(item => item.ticker === ticker).map(item => ({ id: `analyst-${item.id}`, ...analystNewsDisplay(item, lang), at: item.publishedAt, kind: "published" })),
    ...(data?.items ?? []).filter(item => item.tickers.includes(ticker)).map(item => ({ id: `news-${item.id}`, label: ja ? "企業ニュース" : "Company news", title: ja ? item.summaryJa : item.summaryEn, body: ja ? item.impactJa : item.impactEn, at: item.publishedAt, kind: "published" })),
  ].sort((a,b) => Date.parse(b.at)-Date.parse(a.at));
  return <details className={styles.activity} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className={styles.heading}><span>{ja ? "関連ニュース" : "Related news"}</span><small>{ticker}</small></summary>
    {failed && <p className={styles.state} role="status">{ja ? "最新の配信状況を確認できません。" : "Unable to check the latest feed."}{data && (ja ? " 前回取得した記事を表示しています。" : " Showing previously loaded articles.")} <button onClick={() => setAttempt(value => value + 1)}>{ja ? "再試行" : "Retry"}</button></p>}
    {!data && !failed && <p className={styles.state} role="status">{ja ? "配信済み記事を読み込んでいます…" : "Loading published updates…"}</p>}
    {data && !rows.length && <p className={styles.state}>{ja ? "現在の配信データ内にMUの記事はありません。ニュースが発生していないことを示すものではありません。" : "No MU articles appear in the current feed window. This does not mean no news occurred."}</p>}
    {!!rows.length && <div className={styles.list}>{rows.slice(0, 5).map(row => <article key={row.id}><NewsStory lang={lang} label={row.label} title={row.title} body={row.body} publication={`${row.kind === "observed" ? (ja ? "取得" : "Found") : (ja ? "発表" : "Published")} ${shortNewsTime(row.at, row.kind)}`}/></article>)}</div>}
    {rows.length > 5 && <details className={styles.more}><summary>{ja ? `ほか${rows.length - 5}件を見る` : `Show ${rows.length - 5} more`}</summary>{rows.slice(5).map(row => <article key={row.id}><NewsStory lang={lang} label={row.label} title={row.title} body={row.body} publication={`${row.kind === "observed" ? (ja ? "取得" : "Found") : (ja ? "発表" : "Published")} ${shortNewsTime(row.at, row.kind)}`}/></article>)}</details>}
    {data && <p className={styles.note}>{ja ? "直近の配信済み記事を表示。全期間の履歴ではありません。" : "Recent published feed; not a complete historical archive."}</p>}
  </details>;
}
