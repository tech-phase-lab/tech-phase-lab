"use client";

import { noBreakUnits } from "@/lib/research/no-break-units";
import { useEffect, useState, type ReactNode } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { calendarDateKey } from "@/lib/research/calendar";
import { publicNewsPayload, type EventResult, type OfficialUpdate } from "@/lib/research/general-news";
import { mergeEconomicResults } from "@/lib/research/pce-results";
import { earningsResults } from "@/lib/research/earnings-results";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import styles from "../research-tools.module.css";
import calendarStyles from "./event-calendar.module.css";
import DeepAnalysisPanel from "../deep-analysis-panel";
import { useOwnerMode } from "../member-display-provider";

function ResultList({ rows, lang }: { rows: ReactNode[]; lang: "ja" | "en" }) {
  const [limit, setLimit] = useState(3);
  const remaining = rows.length - limit;
  return <>
    <ol className={calendarStyles.agenda}>{rows.slice(0, limit)}</ol>
    {remaining > 0 && <button className={calendarStyles.moreResults} onClick={() => setLimit(value => value + 3)}>{lang === "ja" ? `さらに${Math.min(3, remaining)}件を見る` : `Show ${Math.min(3, remaining)} more`}<span aria-hidden="true">＋</span></button>}
  </>;
}

export default function EconomicResultsPanel({ lang, zone, period, kind = "all", active = true, onSettled, onReported }: { lang: "ja" | "en"; zone: string; period: string; active?: boolean; kind?: "all" | "earnings" | "economic"; onSettled?: () => void; onReported?: (rows: { ticker: string; at: number }[]) => void }) {
  const [updates, setUpdates] = useState<OfficialUpdate[]>([]);
  const [briefs, setBriefs] = useState<ResultBrief[]>([]);
  const [events, setEvents] = useState<EventResult[]>([]);
  const ownerMode = useOwnerMode();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const poller = createNewsPoller({
      push: true,
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw Error("unavailable");
        return publicNewsPayload(await response.json());
      },
      onSuccess: payload => { setUpdates(payload.officialUpdates ?? []); setBriefs(payload.resultBriefs ?? []); setEvents(payload.eventResults ?? []); setFailed(false); setLoaded(true); },
      onFailure: () => { setUpdates([]); setBriefs([]); setEvents([]); setFailed(true); setLoaded(true); },
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
    // Posted economic releases count too, keyed "econ:ppi" etc., so their calendar row goes away (owner, Oct 15).
    const economic = mergeEconomicResults(updates, briefs, events).filter(row => !ja || row.title.ja).map(row => ({ ticker: `econ:${/^[a-z]+/.exec(row.id)?.[0]}`, at: Date.parse(row.releasedAt) }));
    onReported?.([...earningsResults(updates, briefs).filter(row => !ja || row.result.ja).map(row => ({ ticker: row.ticker, at: Date.parse(row.releasedAt) })), ...economic]);
    // Said after the rows above, in the same step, so the agenda never lists a call that is already posted.
    if (loaded) onSettled?.();
  }, [updates, briefs, events, ja, onReported, onSettled, loaded]);
  if (!active) return null;
  const results = mergeEconomicResults(updates, briefs, events).filter(event => period === "all" || calendarDateKey(event.releasedAt, zone).startsWith(period));
  const zoneLabel = zone === "Asia/Tokyo" ? "JST" : "ET";
  const inPeriod = (at: string) => period === "all" || calendarDateKey(at, zone).startsWith(period);
  // Japanese view never shows English: a release without a checked Japanese title is left out there.
  const earnings = kind === "economic" ? [] : earningsResults(updates, briefs).filter(row => inPeriod(row.releasedAt) && (!ja || row.result.ja));
  if (!earnings.length && (kind === "earnings" || !results.length)) return <p role="status" className={styles.description}>{failed ? (ja ? "結果を取得できません。しばらくしてから再度お試しください。" : "Results are unavailable. Please try again shortly.") : (ja ? "この条件に該当する結果はありません。" : "No results match these filters.")}</p>;
  const time = (at: string) => <time dateTime={at}>{calendarDateKey(at, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at))} {zoneLabel}</small></time>;
  const earningsSection = !!earnings.length && <section className={styles.section} aria-label={ja ? "決算の結果" : "Earnings results"}>
    <h2>{ja ? "決算の結果" : "Earnings results"}</h2>
    <ResultList key={`${lang}:${zone}:${period}:${kind}`} lang={lang} rows={earnings.map(row => {
      const label = <>{time(row.releasedAt)}<span className={calendarStyles.eventName}>{ja ? noBreakUnits(row.title[lang]) : row.title[lang]}<small>{ja ? noBreakUnits(row.result.ja ?? "") : row.result.en}</small></span></>;
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
    })} />
  </section>;
  if (kind === "earnings") return <>{earningsSection || null}</>;
  return <>{earningsSection || null}<DeepAnalysisPanel lang={lang} kind="indicator" />
  <section className={styles.section} aria-label={ja ? "経済指標の結果" : "Economic releases"}>
    <h2>{ja ? "経済指標の結果" : "Economic releases"}</h2>
    {failed && <p role="status" className={styles.description}>{ja ? "最新の結果を取得できません。保存済みの公式確認結果を表示しています。" : "Latest results are unavailable. Showing saved, verified results."}</p>}
    <ResultList key={`${lang}:${zone}:${period}:${kind}`} lang={lang} rows={results.map(event => <li key={event.id}><details>
      <summary><time dateTime={event.releasedAt}>{calendarDateKey(event.releasedAt, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.releasedAt))} {zoneLabel}</small></time><span className={calendarStyles.eventName}>{event.title[lang]}<small>{event.result[lang]}</small></span><span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
      <div className={calendarStyles.eventDetails}><p>{event.detail[lang]}</p>{(() => {
        const auto = events.find(item => item.id === event.id);
        // An automatic result shows every outlet that reported it; the owner can take it down.
        if (auto) return <>{auto.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher} ↗</a>)}{ownerMode && <button type="button" onClick={() => { if (window.confirm(ja ? "この結果を取り下げます。もう自動では載りません。よろしいですか?" : "Withdraw this result? It will not be published again.")) void fetch("/api/research/event-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: auto.id }) }).then(response => { if (response.ok) setEvents(current => current.filter(item => item.id !== auto.id)); }); }}>{ja ? "この結果を取り下げる" : "Withdraw this result"}</button>}</>;
        return !event.sourceUrl.startsWith("https://x.com/") ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a> : null;
      })()}</div>
    </details></li>)} />
  </section></>;
}
