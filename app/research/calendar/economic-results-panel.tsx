"use client";

import { useEffect, useState } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { calendarDateKey } from "@/lib/research/calendar";
import { publicNewsPayload, type OfficialUpdate } from "@/lib/research/general-news";
import { mergeEconomicResults } from "@/lib/research/pce-results";
import { earningsResults } from "@/lib/research/earnings-results";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import styles from "../research-tools.module.css";
import calendarStyles from "./event-calendar.module.css";
import DeepAnalysisPanel from "../deep-analysis-panel";

export default function EconomicResultsPanel({ lang, zone, period, kind = "all", onReported }: { lang: "ja" | "en"; zone: string; period: string; kind?: "all" | "earnings" | "economic"; onReported?: (rows: { ticker: string; at: number }[]) => void }) {
  const [updates, setUpdates] = useState<OfficialUpdate[]>([]);
  const [briefs, setBriefs] = useState<ResultBrief[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const poller = createNewsPoller({
      push: true,
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw Error("unavailable");
        return publicNewsPayload(await response.json());
      },
      onSuccess: payload => { setUpdates(payload.officialUpdates ?? []); setBriefs(payload.resultBriefs ?? []); setFailed(false); },
      onFailure: () => { setUpdates([]); setBriefs([]); setFailed(true); },
    });
    poller.start();
    const stopObserving = observePageActivity(() => poller.resume(), () => poller.pause());
    return () => {
      stopObserving();
      poller.stop();
    };
  }, []);
  const ja = lang === "ja";
  // The agenda below marks a company's call "results posted" from these rows (owner, Oct 15).
  useEffect(() => {
    onReported?.(earningsResults(updates, briefs).filter(row => !ja || row.result.ja).map(row => ({ ticker: row.ticker, at: Date.parse(row.releasedAt) })));
  }, [updates, briefs, ja, onReported]);
  const results = mergeEconomicResults(updates, briefs).filter(event => (period === "upcoming" || period === "today-upcoming") || calendarDateKey(event.releasedAt, zone).startsWith(period));
  const zoneLabel = zone === "Asia/Tokyo" ? "JST" : "ET";
  const inPeriod = (at: string) => period === "upcoming" || period === "today-upcoming" || calendarDateKey(at, zone).startsWith(period);
  // Japanese view never shows English: a release without a checked Japanese title is left out there.
  const earnings = kind === "economic" ? [] : earningsResults(updates, briefs).filter(row => inPeriod(row.releasedAt) && (!ja || row.result.ja)).slice(0, 30);
  const time = (at: string) => <time dateTime={at}>{calendarDateKey(at, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at))} {zoneLabel}</small></time>;
  const earningsSection = !!earnings.length && <section className={styles.section} aria-label={ja ? "発表済みの決算" : "Released earnings"}>
    <h2>{ja ? "発表済みの決算" : "Released earnings"}</h2>
    <ol className={calendarStyles.agenda}>{earnings.map(row => {
      const label = <>{time(row.releasedAt)}<span className={calendarStyles.eventName}>{row.title[lang]}<small>{ja ? row.result.ja : row.result.en}</small></span></>;
      const links = row.sources.filter(source => !source.url.startsWith("https://x.com/")).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>);
      const text = ja ? row.body.ja : row.body.en;
      // A row opens only when there is something more to read; "the company's
      // own release" alone is not a reason to expand (owner, Oct 14).
      if (!row.facts.length && !text) return <li key={row.id}><div className={calendarStyles.plainRow}>{label}<span className={calendarStyles.rowLinks}>{links}</span></div></li>;
      return <li key={row.id}><details>
        <summary>{label}<span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
        <div className={calendarStyles.eventDetails}>
          {!!row.facts.length && <ul className={calendarStyles.facts}>{row.facts.map(fact => <li key={fact.en}>{ja ? fact.ja : fact.en}</li>)}</ul>}
          {row.kind === "flash" && <p>{ja ? "決算速報の投稿から数値を読み取りました。会社の決算資料で確認してください。" : "Figures read from a results flash post; confirm against the company release."}</p>}
          {!!text && <p>{text.length > 500 ? `${text.slice(0, 500).replace(/[^。.!?！？]*$/, "").trim() || text.slice(0, 500)}…` : text}</p>}
          {links}
        </div>
      </details></li>;
    })}</ol>
  </section>;
  if (kind === "earnings") return <>{earningsSection || null}</>;
  return <>{earningsSection || null}<DeepAnalysisPanel lang={lang} kind="indicator" />
  <section className={styles.section} aria-label={ja ? "発表済みの結果" : "Released results"}>
    <h2>{ja ? "発表済みの結果" : "Released results"}</h2>
    {failed && <p role="status" className={styles.description}>{ja ? "最新の結果を取得できません。保存済みの公式確認結果を表示しています。" : "Latest results are unavailable. Showing saved, verified results."}</p>}
    <ol className={calendarStyles.agenda}>{results.map(event => <li key={event.id}><details>
      <summary><time dateTime={event.releasedAt}>{calendarDateKey(event.releasedAt, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.releasedAt))} {zoneLabel}</small></time><span className={calendarStyles.eventName}>{event.title[lang]}<small>{event.result[lang]}</small></span><span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
      <div className={calendarStyles.eventDetails}><p>{event.detail[lang]}</p>{!event.sourceUrl.startsWith("https://x.com/") && <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a>}</div>
    </details></li>)}</ol>
  </section></>;
}
