"use client";

import { noBreakUnits } from "@/lib/research/no-break-units";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { calendarDateKey, calendarEvents, dateOnlyEvents } from "@/lib/research/calendar";
import { publicNewsPayload, type EventResult, type OfficialUpdate } from "@/lib/research/general-news";
import { mergeEconomicResults } from "@/lib/research/pce-results";
import { releaseView, type Scheduled } from "@/lib/research/economic-release-view";
import EconomicReleaseItem from "./economic-release-item";
import { earningsResults } from "@/lib/research/earnings-results";
import { checkedBriefs, oneResultPerQuarter } from "@/lib/research/earnings-results-history";
import { createNewsPoller } from "@/lib/research/news-poller";
import { observePageActivity } from "@/lib/research/page-activity";
import styles from "../research-tools.module.css";
import calendarStyles from "./event-calendar.module.css";
import DeepAnalysisPanel from "../deep-analysis-panel";
import { useOwnerAccount } from "../member-display-provider";
import XPostCopyButton from "./x-post-copy-button";
import EarningsReaction from "./earnings-reaction";
import EarningsResultTable from "./earnings-result-table";
import { headline } from "@/lib/research/earnings-table";
import { japaneseMoney } from "@/lib/research/money-ja";

// Scheduled economic releases, for the "next release" line. A day-only date (FOMC) is placed at noon New York time so it keeps its day.
const economicSchedule: Scheduled[] = [
  ...calendarEvents.filter(event => event.kind === "economic").map(event => ({ id: event.id, at: event.startsAt })),
  ...dateOnlyEvents.filter(event => event.kind === "economic").map(event => ({ id: event.id, at: `${event.date}T12:00:00-05:00`, dateOnly: true })),
];

function ResultList({ rows, lang }: { rows: ReactNode[]; lang: "ja" | "en" }) {
  const [limit, setLimit] = useState(3);
  const remaining = rows.length - limit;
  return <>
    <ol className={calendarStyles.agenda}>{rows.slice(0, limit)}</ol>
    {remaining > 0 && <button className={calendarStyles.moreResults} onClick={() => setLimit(value => value + 3)}>{lang === "ja" ? `さらに${Math.min(3, remaining)}件を見る` : `Show ${Math.min(3, remaining)} more`}<span aria-hidden="true">＋</span></button>}
  </>;
}

export default function EconomicResultsPanel({ lang, zone, period, kind = "all", active = true, onSettled, onReported, onMonths }: { lang: "ja" | "en"; zone: string; period: string; active?: boolean; kind?: "all" | "earnings" | "economic"; onSettled?: () => void; onReported?: (rows: { ticker: string; at: number }[]) => void; onMonths?: (months: string[]) => void }) {
  const [updates, setUpdates] = useState<OfficialUpdate[]>([]);
  const [liveBriefs, setBriefs] = useState<ResultBrief[]>([]);
  // Results older than the news feed's seven days, by month (owner, Nov 18): the monitor's stored results and the SEC backfill.
  const [history, setHistory] = useState<Record<string, ResultBrief[]>>({});
  const ownerAccount = useOwnerAccount();
  const [events, setEvents] = useState<EventResult[]>([]);
  const [failed, setFailed] = useState(false);
  // "Next release" is the next scheduled date after the page opened.
  const [openedAt] = useState(() => Date.now());
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
  const historyMonth = period === "all" ? "recent" : period;
  useEffect(() => {
    if (kind === "economic" || history[historyMonth]) return;
    const controller = new AbortController();
    fetch(`/api/research/earnings-results?month=${encodeURIComponent(historyMonth)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (!body) return;
        setHistory(current => ({ ...current, [historyMonth]: checkedBriefs(body.resultBriefs) }));
        if (Array.isArray(body.months)) onMonths?.(body.months.filter((month: unknown): month is string => typeof month === "string" && /^20\d\d-\d\d$/.test(month)));
      }).catch(() => {});
    return () => controller.abort();
  }, [historyMonth, kind, history, onMonths]);
  // One copy of each result: the live feed's, then the stored ones of every month read so far; one row per company and quarter.
  const briefs = useMemo(() => {
    const seen = new Set<string>();
    const unique = (list: typeof liveBriefs) => list.filter(brief => { const key = `${brief.researchId}|${brief.url}`; if (seen.has(key)) return false; seen.add(key); return true; });
    const live = unique(liveBriefs);
    return oneResultPerQuarter(live, unique(Object.values(history).flat()));
  }, [liveBriefs, history]);
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
  // Every stored release, not only this period's: the previous release, the history and the forecast are read from them.
  const allEconomic = mergeEconomicResults(updates, briefs, events);
  const expectations = events.filter(item => item.id.startsWith("expected-")).map(item => ({ id: item.id, resultJa: item.resultJa, resultEn: item.resultEn }));
  const results = allEconomic.filter(event => period === "all" || calendarDateKey(event.releasedAt, zone).startsWith(period));
  const zoneLabel = zone === "Asia/Tokyo" ? "JST" : "ET";
  const inPeriod = (at: string) => period === "all" || calendarDateKey(at, zone).startsWith(period);
  // Japanese view never shows English: a release without a checked Japanese title is left out there.
  const earnings = kind === "economic" ? [] : earningsResults(updates, briefs).filter(row => inPeriod(row.releasedAt) && (!ja || row.result.ja));
  if (!earnings.length && (kind === "earnings" || !results.length)) return <p role="status" className={styles.description}>{failed ? (ja ? "結果を取得できません。しばらくしてから再度お試しください。" : "Results are unavailable. Please try again shortly.") : (ja ? "この条件に該当する結果はありません。" : "No results match these filters.")}</p>;
  const time = (at: string) => <time dateTime={at}>{calendarDateKey(at, zone).slice(5).replace("-", "/")}<small>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at))} {zoneLabel}</small></time>;
  const earningsSection = !!earnings.length && <section className={styles.section} aria-label={ja ? "決算の結果" : "Earnings results"}>
    <h2>{ja ? "決算の結果" : "Earnings results"}</h2>
    <ResultList key={`${lang}:${zone}:${period}:${kind}`} lang={lang} rows={earnings.map(row => {
      // The collapsed line names the key figures in one notation (owner, Nov 23); a row without figures keeps the release's title.
      const summary = headline(row.figures, lang);
      const label = <>{time(row.releasedAt)}<span className={calendarStyles.eventName}>{ja ? noBreakUnits(japaneseMoney(row.title[lang])) : row.title[lang]}<small>{summary ? (ja ? noBreakUnits(summary) : summary) : ja ? noBreakUnits(japaneseMoney(row.result.ja ?? "")) : row.result.en}</small></span></>;
      const links = row.sources.filter(source => !source.url.startsWith("https://x.com/")).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>);
      const text = ja ? (row.body.ja && japaneseMoney(row.body.ja)) : row.body.en;
      // A row opens only when there is something more to read; "the company's
      // own release" alone is not a reason to expand (owner, Oct 14).
      if (!row.figures.length && !row.facts.length && !text) return <li key={row.id}><div className={calendarStyles.plainRow}>{label}<span className={calendarStyles.rowLinks}>{links}</span></div></li>;
      return <li key={row.id}><details>
        <summary>{label}<span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
        <div className={calendarStyles.eventDetails}>
          {!!row.figures.length && (() => {
            // one table of the figures (項目 / 実績 / 前年比 / 市場予想との差, then the guidance) and the price move in one line (owner, Nov 23)
            const brief = briefs.find(b => b.kind === "earnings" && b.ticker === row.ticker && !!b.facts.length && row.sources.some(source => source.url === b.url));
            return <>
              <EarningsResultTable ticker={row.ticker} releasedAt={row.releasedAt} facts={row.figures} lang={lang}
                xPost={consensus => brief ? <>{ownerAccount && <XPostCopyButton brief={brief} lang={lang} consensus={consensus} />}</> : null} />
              <EarningsReaction ticker={row.ticker} releasedAt={row.releasedAt} lang={lang} />
            </>;
          })()}
          {row.factsFrom === "post" && <p>{ja ? "数値は速報投稿によるもので、会社資料では未確認です。" : "Figures from a results flash post, not yet checked against the company release."}</p>}
          {!row.figures.length && !!text && <p>{text.length > 500 ? `${text.slice(0, 500).replace(/[^。.!?！？]*$/, "").trim() || text.slice(0, 500)}…` : text}</p>}
          {links}
        </div>
      </details></li>;
    })} />
    <p className={calendarStyles.credit}>{ja ? "数値：各社の決算資料（SEC提出書類・IR） 株価・市場予想：Twelve Data" : "Figures: each company's release (SEC filing or IR). Prices and consensus: Twelve Data"}</p>
  </section>;
  if (kind === "earnings") return <>{earningsSection || null}</>;
  return <>{earningsSection || null}<DeepAnalysisPanel lang={lang} kind="indicator" />
  <section className={styles.section} aria-label={ja ? "経済指標の結果" : "Economic releases"}>
    <h2>{ja ? "経済指標の結果" : "Economic releases"}</h2>
    {failed && <p role="status" className={styles.description}>{ja ? "最新の結果を取得できません。保存済みの公式確認結果を表示しています。" : "Latest results are unavailable. Showing saved, verified results."}</p>}
    <ResultList key={`${lang}:${zone}:${period}:${kind}`} lang={lang} rows={results.map(event => {
      const auto = events.find(item => item.id === event.id);
      // Withdrawing an automatic result is an operator action: the owner accounts only, never members (owner, Nov 24).
      const withdraw = auto && ownerAccount ? () => { if (window.confirm(ja ? "この結果を取り下げます。もう自動では載りません。よろしいですか?" : "Withdraw this result? It will not be published again.")) void fetch("/api/research/event-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: auto.id }) }).then(response => { if (response.ok) setEvents(current => current.filter(item => item.id !== auto.id)); }); } : undefined;
      return <EconomicReleaseItem key={event.id} lang={lang} title={event.title[lang]} time={time(event.releasedAt)} withdraw={withdraw}
        view={releaseView(event, allEconomic, expectations, economicSchedule, openedAt, lang)}
        when={(at, dateOnly) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, month: "numeric", day: "numeric", weekday: "short", ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }) }).format(new Date(at)) + (dateOnly ? "" : ` ${zoneLabel}`)} />;
    })} />
  </section></>;
}
