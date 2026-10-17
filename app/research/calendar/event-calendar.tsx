"use client";

import { useCallback, useState } from "react";
import { calendarDateKey, dateOnlyEvents, selectDateOnlyEvents, calendarEvents, selectCalendarEvents, type CalendarEvent } from "@/lib/research/calendar";
import { useCalendarClock } from "../use-calendar-clock";
import coverage from "@/lib/research/calendar-coverage.json";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import styles from "../research-tools.module.css";
import calendarStyles from "./event-calendar.module.css";
import { calendarInsight } from "./calendar-insights";
import EconomicResultsPanel from "./economic-results-panel";

const earningsFocus: Record<string, { ja: string; en: string }> = {
  MU: { ja: "注目点：DRAM・NANDの売上と価格動向／粗利益率／HBMと設備投資／次四半期の会社見通し", en: "Watch: DRAM/NAND revenue and pricing; gross margin; HBM and capex; next-quarter guidance." },
  TSM: { ja: "注目点：HPC・先端プロセスの売上構成／粗利益率／設備投資／次四半期の会社見通し", en: "Watch: HPC and advanced-node revenue mix; gross margin; capex; next-quarter guidance." },
  ASML: { ja: "注目点：受注額・受注残／EUVの売上／粗利益率／通期見通し", en: "Watch: net bookings and backlog; EUV sales; gross margin; full-year guidance." },
  GEV: { ja: "注目点：受注・受注残／部門別利益率／フリーキャッシュフロー／会社見通し", en: "Watch: orders and backlog; segment margins; free cash flow; guidance." },
  NFLX: { ja: "注目点：売上成長／営業利益率／広告事業の進捗／フリーキャッシュフローと見通し", en: "Watch: revenue growth; operating margin; advertising progress; free cash flow and guidance." },
  ADBE: { ja: "注目点：継続収益の成長／部門別売上／利益率／AI製品の収益化と会社見通し", en: "Watch: recurring-revenue growth; segment revenue; margins; AI monetization and guidance." },
};

function IndicatorGuide({ id, lang }: { id: string; lang: "ja" | "en" }) {
  const guide = calendarInsight(id, lang);
  if (!guide) return null;
  return <dl className={calendarStyles.insights}><dt>{lang === "ja" ? "どんな指標？" : "What it is"}</dt><dd>{guide.what}</dd><dt>{lang === "ja" ? "見るポイント" : "What to watch"}</dt><dd>{guide.watch}</dd><dt>{lang === "ja" ? "読み方" : "How to read it"}</dt><dd>{guide.reading}</dd></dl>;
}

export default function EventCalendar() {
  const [lang, setLang] = useResearchLanguage();
  const [kind, setKind] = useState<"all" | CalendarEvent["kind"]>("all");
  const [zoneOverride, setZoneOverride] = useState<string | null>(null);
  const zone = zoneOverride ?? (lang === "ja" ? "Asia/Tokyo" : "America/New_York");
  const otherZone = zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
  const zoneLabel = (value: string) => value === "Asia/Tokyo" ? "JST" : "ET";
  const months = [...new Set([...calendarEvents.map((event) => calendarDateKey(event.startsAt, zone).slice(0, 7)), ...dateOnlyEvents.map((event) => event.date.slice(0, 7))])].sort();
  const [period, setPeriod] = useState("today-upcoming");
  const [reported, setReported] = useState<{ ticker: string; at: number }[]>([]);
  const onReported = useCallback((rows: { ticker: string; at: number }[]) => setReported(rows), []);
  // A company whose result is already in the "released" list above no longer keeps its call row (owner, Oct 15).
  // The same goes for an economic release (jobs, CPI, PPI, PCE) once its result is posted.
  const resultKey = (event: CalendarEvent) => event.ticker ?? (event.kind === "economic" ? `econ:${/^[a-z]+/.exec(event.id)?.[0]}` : undefined);
  const resultPosted = (event: CalendarEvent) => { const key = resultKey(event); return !!key && reported.some(row => row.ticker === key && Math.abs(row.at - Date.parse(event.startsAt)) <= 36 * 3_600_000); };
  const now = useCalendarClock();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const visible = now === null ? [] : selectCalendarEvents(calendarEvents, kind, period, now, zone).filter(event => !resultPosted(event));
  const visibleDateOnly = now === null ? [] : selectDateOnlyEvents(dateOnlyEvents, kind, period, now);
  const stamp = (value: string, zone: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  return <ResearchToolShell lang={lang} setLang={(value) => { setLang(value); setZoneOverride(null); setPeriod("today-upcoming"); }} title={t("決算・経済指標カレンダー", "Earnings & economic calendar")} description={t("相場の転機を、見逃さない。", "Don’t miss the moments that move markets.")}>
    <div className={calendarStyles.filters}>
      <div role="group" aria-label={t("予定の種類", "Event category")}>{(["all", "earnings", "economic"] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? t("すべて", "All") : value === "earnings" ? t("決算", "Earnings") : t("経済指標・FOMC", "Economy & FOMC")}</button>)}</div>
      <label>{t("期間", "Period")} ({zoneLabel(zone)})<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="today-upcoming">{t("今日・今後の予定", "Today & upcoming")}</option><option value="upcoming">{t("今後の予定", "Upcoming")}</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
      <label>{t("表示時間", "Time zone")}<select value={zone} onChange={(event) => { setZoneOverride(event.target.value); setPeriod("today-upcoming"); }}><option value="Asia/Tokyo">{t("日本時間", "Japan · JST")}</option><option value="America/New_York">{t("米国東部", "U.S. Eastern · ET")}</option></select></label>
    </div>
    <EconomicResultsPanel lang={lang} zone={zone} period={period} kind={kind} onReported={onReported} />
    <ol className={calendarStyles.agenda}>{visible.map((event) => <li key={event.id}>
      <details>
        <summary>
          <time dateTime={event.startsAt}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "numeric", day: "numeric", weekday: "short" }).format(new Date(event.startsAt))}<small>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.startsAt))} {zoneLabel(zone)}</small></time>
          <span className={calendarStyles.eventName}>{event.title[lang]}{now !== null && Date.parse(event.startsAt) < now && <small>{t("予定時刻を経過", "Scheduled time passed")}</small>}</span>
          <span className={calendarStyles.expand} aria-hidden="true">＋</span>
        </summary>
        <div className={calendarStyles.eventDetails}>
          <IndicatorGuide id={event.id} lang={lang} />
          {event.note && <p>{event.note[lang]}</p>}
          {event.ticker && earningsFocus[event.ticker] && <p>{earningsFocus[event.ticker][lang]}</p>}
          <details className={calendarStyles.sourceDetails}><summary>{t("日時・出典", "Time & source")}</summary><small>{stamp(event.startsAt, zone)} · {zoneLabel(zone)} · {calendarDateKey(event.startsAt, zone).slice(0, 4)}<br />{stamp(event.startsAt, otherZone)} · {zoneLabel(otherZone)}</small>
          <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a></details>
        </div>
      </details>
    </li>)}</ol>
    {now !== null && visible.length === 0 && visibleDateOnly.length === 0 && <div className={styles.empty}><strong>{t("この条件で登録済みの予定はありません。", "No registered events match this filter.")}</strong><p>{t("発表がないという意味ではありません。期間を変更するか、公式日程をご確認ください。", "This does not mean no events are scheduled. Change the filter or check the official schedules.")}</p></div>}
    <section className={styles.section}>
      {visibleDateOnly.length > 0 && <><h2>{t("時刻未公表の予定", "Dates awaiting a time")}</h2>
      <ol className={calendarStyles.agenda}>{visibleDateOnly.map((event) => <li key={event.id}><details>
        <summary><time dateTime={event.date}>{event.date.slice(5).replace("-", "/")}<small>{t("時刻未定", "Time TBD")}</small></time><span className={calendarStyles.eventName}>{event.title[lang]}</span><span className={calendarStyles.expand} aria-hidden="true">＋</span></summary>
        <div className={calendarStyles.eventDetails}>
          <IndicatorGuide id={event.id} lang={lang} />{event.ticker && earningsFocus[event.ticker] && <p>{earningsFocus[event.ticker][lang]}</p>}<p>{event.note?.[lang] ?? t("公式掲載日です。時刻未公表のためET/JSTへの日付換算はしていません。", "Official calendar date; not converted to ET/JST because no time has been confirmed.")}</p><details className={calendarStyles.sourceDetails}><summary>{t("日付・出典", "Date & source")}</summary><small>{event.date}</small><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a></details></div>
      </details></li>)}</ol></>}

      <details className={calendarStyles.coverage}>
        <summary>{t("決算の追跡対象", "Earnings coverage")} · {coverage.length}{t("社", " companies")}</summary>
        <div className={calendarStyles.coverageList} tabIndex={0} role="region" aria-label={t("決算の追跡対象一覧", "Companies covered")}><ul>{coverage.map((company) => <li key={company.ticker}><a href={company.sourceUrl} target="_blank" rel="noreferrer">{company.name}</a></li>)}</ul></div>
      </details>
    </section>
    <p className={calendarStyles.publicationNote}>{t("公式発表の確認結果と数値速報を掲載。決算速報のスマホ通知はPRO会員向けです。", "Officially verified results and early figures are shown. Earnings push notifications are available to PRO members.")}</p>
  </ResearchToolShell>;
}
