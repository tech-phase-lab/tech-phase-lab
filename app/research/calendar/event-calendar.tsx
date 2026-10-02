"use client";

import { useState } from "react";
import { calendarDateKey, dateOnlyEvents, selectDateOnlyEarnings, selectDateOnlyEvents, calendarEvents, calendarReviewedOn, selectCalendarEvents, type CalendarEvent } from "@/lib/research/calendar";
import { filterFavoriteEvents } from "@/lib/research/favorites";
import { useStockFavorites } from "../use-stock-favorites";
import { useCalendarClock } from "../use-calendar-clock";
import Link from "next/link";
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
  const { favorites } = useStockFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [kind, setKind] = useState<"all" | CalendarEvent["kind"]>("all");
  const [zoneOverride, setZoneOverride] = useState<string | null>(null);
  const zone = zoneOverride ?? (lang === "ja" ? "Asia/Tokyo" : "America/New_York");
  const otherZone = zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
  const zoneLabel = (value: string) => value === "Asia/Tokyo" ? "JST" : "ET";
  const months = [...new Set([...calendarEvents.map((event) => calendarDateKey(event.startsAt, zone).slice(0, 7)), ...dateOnlyEvents.map((event) => event.date.slice(0, 7))])].sort();
  const [period, setPeriod] = useState("today-upcoming");
  const now = useCalendarClock();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const visible = now === null ? [] : selectCalendarEvents(favoritesOnly ? filterFavoriteEvents(calendarEvents, favorites) : calendarEvents, kind, period, now, zone);
  const visibleDateOnly = now === null ? [] : selectDateOnlyEvents(favoritesOnly ? filterFavoriteEvents(dateOnlyEvents, favorites) : dateOnlyEvents, kind, period, now);
  const reviewedCompanies = coverage.filter((company) => company.lastCheckedOn !== null).length;
  const pendingCompanies = coverage.length - reviewedCompanies;
  const stale = now !== null && now - Date.parse(`${calendarReviewedOn}T00:00:00+09:00`) > 7 * 86400000;
  const stamp = (value: string, zone: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const coverageStatus = (company: (typeof coverage)[number]) => {
    if (calendarEvents.some((event) => event.ticker === company.ticker && (now === null || Date.parse(event.startsAt) >= now))) return t("予定掲載済み", "Schedule listed");
    if (now !== null && selectDateOnlyEarnings("upcoming", now).some((event) => event.ticker === company.ticker)) return t("日付のみ確認", "Date confirmed; time pending");
    if (company.lastCheckedOn !== null) return t(`公式確認済み・確定日なし（${company.lastCheckedOn}）`, `Official source checked; no confirmed date (${company.lastCheckedOn})`);
    return t(`公式確認試行済み・確認継続（${company.lastAttemptedOn}）`, `Official check attempted; still under review (${company.lastAttemptedOn})`);
  };
  return <ResearchToolShell lang={lang} setLang={(value) => { setLang(value); setZoneOverride(null); setPeriod("today-upcoming"); }} title={t("決算・経済指標カレンダー", "Earnings & economic calendar")} description={t("公式発表で確認した予定を、日本時間と米国東部時間で。", "Official schedules in U.S. Eastern and Japan time.")}>
    <details className={calendarStyles.status}><summary>{t("公式確認", "Verified")} · {calendarReviewedOn}<span>{t("掲載方針", "About this calendar")}</span></summary><p>{t("公式確認済みの予定を掲載。未確認の企業は下の追跡対象に表示します。日程は変更される場合があります。", "Verified schedules only. Companies awaiting date confirmation are listed below. Dates may change.")}</p></details>
    {stale && <p role="status" className={styles.error}>{t("確認から7日以上経過しています。参加・視聴前に公式日程を再確認してください。", "This schedule was checked over 7 days ago. Recheck the official source before attending.")}</p>}
    <div className={calendarStyles.filters}>
      <div role="group" aria-label={t("予定の種類", "Event category")}>{(["all", "earnings", "economic"] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? t("すべて", "All") : value === "earnings" ? t("決算", "Earnings") : t("経済指標・FOMC", "Economy & FOMC")}</button>)}</div>
      <label>{t("期間", "Period")} ({zoneLabel(zone)})<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="today-upcoming">{t("今日・今後の予定", "Today & upcoming")}</option><option value="upcoming">{t("今後の予定", "Upcoming")}</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
      <label>{t("表示時間", "Time zone")}<select value={zone} onChange={(event) => { setZoneOverride(event.target.value); setPeriod("today-upcoming"); }}><option value="Asia/Tokyo">{t("日本時間", "Japan · JST")}</option><option value="America/New_York">{t("米国東部", "U.S. Eastern · ET")}</option></select></label>
    </div>
    <div className={calendarStyles.watchFilter}>
      <label><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />{t("お気に入り＋経済指標", "Favorites + economic events")}</label>
      <Link href="/research/watchlist">{t("銘柄を編集", "Edit favorites")}</Link>
    </div>
    {favoritesOnly && favorites.length === 0 && <p role="status" className={styles.description}>{t("お気に入りがまだありません。銘柄を追加すると、その決算予定も表示します。", "No favorites yet. Add companies to include their earnings schedules.")}</p>}
    <p aria-live="polite" className={styles.description}>{now === null ? t("予定を読み込み中…", "Loading schedule…") : t(`${visible.length + visibleDateOnly.length}件の予定`, `${visible.length + visibleDateOnly.length} events`)}</p>
    {kind !== "earnings" && <EconomicResultsPanel lang={lang} zone={zone} period={period} />}
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

      <details className={styles.coverage}>
        <summary>{t("決算の追跡対象", "Earnings coverage")} · {coverage.length}{t("社", " companies")}</summary>
        <p className={styles.description}>{t(`公式照合済み ${reviewedCompanies}社 · 確認継続 ${pendingCompanies}社。確定日がない企業を予想日で埋めず、公式確認後に追加します。`, `${reviewedCompanies} official sources checked · ${pendingCompanies} still under review. We add confirmed dates rather than filling gaps with estimates.`)}</p>
        <ul>{coverage.map((company) => <li key={company.ticker}><a href={company.sourceUrl} target="_blank" rel="noreferrer"><strong>{company.ticker}</strong> {company.name} ↗</a><small>{coverageStatus(company)}</small></li>)}</ul>
      </details>
    </section>
    <p className={styles.notice}>{t("PCEは公式本文の照合後に結果を更新します。市場予想との比較・PCE以外の結果の自動更新・自動通知は未対応です。", "PCE results update after checks against the official release. Consensus comparisons, automatic updates for other results and notifications are not yet available.")}</p>
    <p className={styles.footnote}>{t("日付・期間は選択した時間帯が基準です。米国の夏時間・冬時間を反映しています。", "Dates and month filters follow the selected time zone. ET accounts for U.S. daylight saving.")}</p>
  </ResearchToolShell>;
}
