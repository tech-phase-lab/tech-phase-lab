"use client";

import { useEffect, useState } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { calendarDateKey } from "@/lib/research/calendar";
import { publicNewsPayload, type OfficialUpdate } from "@/lib/research/general-news";
import { mergeEconomicResults } from "@/lib/research/pce-results";
import { createNewsPoller } from "@/lib/research/news-poller";
import styles from "../research-tools.module.css";
import calendarStyles from "./event-calendar.module.css";

export default function EconomicResultsPanel({ lang, zone, period }: { lang: "ja" | "en"; zone: string; period: string }) {
  const [updates, setUpdates] = useState<OfficialUpdate[]>([]);
  const [briefs, setBriefs] = useState<ResultBrief[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const poller = createNewsPoller({
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw Error("unavailable");
        return publicNewsPayload(await response.json());
      },
      onSuccess: payload => { setUpdates(payload.officialUpdates ?? []); setBriefs(payload.resultBriefs ?? []); setFailed(false); },
      onFailure: () => { setUpdates([]); setBriefs([]); setFailed(true); },
    });
    poller.start();
    const wake = () => poller.wake();
    const visible = () => { if (document.visibilityState === "visible") wake(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", visible);
      poller.stop();
    };
  }, []);
  const ja = lang === "ja";
  const results = mergeEconomicResults(updates, briefs).filter(event => (period === "upcoming" || period === "today-upcoming") || calendarDateKey(event.releasedAt, zone).startsWith(period));
  const zoneLabel = zone === "Asia/Tokyo" ? "JST" : "ET";
  return <section className={styles.section} aria-label={ja ? "発表済みの結果" : "Released results"}>
    <h2>{ja ? "発表済みの結果" : "Released results"}</h2>
    {failed && <p role="status" className={styles.description}>{ja ? "PCEの自動取得に接続できません。保存済みの公式確認結果を表示しています。" : "Automatic PCE updates are unavailable. Showing saved, verified results."}</p>}
    <ol className={calendarStyles.agenda}>{results.map(event => <li key={event.id}><details>
      <summary><time dateTime={event.releasedAt}>{calendarDateKey(event.releasedAt, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.releasedAt))} {zoneLabel}</small></time><span className={calendarStyles.eventName}>{event.title[lang]}<small>{event.result[lang]}</small></span><span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
      <div className={calendarStyles.eventDetails}><p>{event.detail[lang]}</p><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a></div>
    </details></li>)}</ol>
  </section>;
}
