"use client";

import { useState, useSyncExternalStore } from "react";
import { calendarDateKey, dateOnlyEarnings, selectDateOnlyEarnings, calendarEvents, calendarReviewedOn, selectCalendarEvents, type CalendarEvent } from "@/lib/research/calendar";
import coverage from "@/lib/research/calendar-coverage.json";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import styles from "../research-tools.module.css";

function subscribeClock(notify: () => void) {
  const timer = window.setInterval(notify, 60000);
  document.addEventListener("visibilitychange", notify);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", notify); };
}
function clockSnapshot() { return Math.floor(Date.now() / 60000) * 60000; }


export default function EventCalendar() {
  const [lang, setLang] = useResearchLanguage();
  const [kind, setKind] = useState<"all" | CalendarEvent["kind"]>("all");
  const [zoneOverride, setZoneOverride] = useState<string | null>(null);
  const zone = zoneOverride ?? (lang === "ja" ? "Asia/Tokyo" : "America/New_York");
  const otherZone = zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
  const zoneLabel = (value: string) => value === "Asia/Tokyo" ? "JST" : "ET";
  const months = [...new Set([...calendarEvents.map((event) => calendarDateKey(event.startsAt, zone).slice(0, 7)), ...dateOnlyEarnings.map((event) => event.date.slice(0, 7))])].sort();
  const [period, setPeriod] = useState("upcoming");
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const visible = now === null ? [] : selectCalendarEvents(calendarEvents, kind, period, now, zone);
  const visibleDateOnly = now === null || kind === "economic" ? [] : selectDateOnlyEarnings(period, now);
  const stale = now !== null && now - Date.parse(`${calendarReviewedOn}T00:00:00+09:00`) > 7 * 86400000;
  const stamp = (value: string, zone: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  return <ResearchToolShell lang={lang} setLang={(value) => { setLang(value); setZoneOverride(null); setPeriod("upcoming"); }} title={t("決算・経済指標カレンダー", "Earnings & economic calendar")} description={t("公式発表で確認した予定を、日本時間と米国東部時間で。", "Official schedules in U.S. Eastern and Japan time.")}>
    <p className={styles.notice}>{t("公式予定の確認日", "Schedule checked")}: {calendarReviewedOn} · {t("公式確認済みの予定を掲載。未確認の企業は下の追跡対象に表示します。日程は変更される場合があります。", "Verified schedules only. Companies awaiting date confirmation are listed below. Dates may change.")}</p>
    {stale && <p role="status" className={styles.error}>{t("確認から7日以上経過しています。参加・視聴前に公式日程を再確認してください。", "This schedule was checked over 7 days ago. Recheck the official source before attending.")}</p>}
    <div className={styles.filters}>
      <div role="group" aria-label={t("予定の種類", "Event category")}>{(["all", "earnings", "economic"] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? t("すべて", "All") : value === "earnings" ? t("決算", "Earnings") : t("経済指標・FOMC", "Economy & FOMC")}</button>)}</div>
      <label>{t("期間", "Period")} ({zoneLabel(zone)})<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="upcoming">{t("今後の予定", "Upcoming")}</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
      <label>{t("表示時間", "Time zone")}<select value={zone} onChange={(event) => { setZoneOverride(event.target.value); setPeriod("upcoming"); }}><option value="Asia/Tokyo">JST · Japan</option><option value="America/New_York">ET · U.S. Eastern</option></select></label>
    </div>
    <p className={styles.description}>{t("日付・期間は選択した時間帯が基準です。米国の夏時間・冬時間を反映しています。", "Dates and month filters follow the selected time zone. ET accounts for U.S. daylight saving.")}</p>
    <p aria-live="polite" className={styles.description}>{now === null ? t("予定を読み込み中…", "Loading schedule…") : t(`${visible.length + visibleDateOnly.length}件の予定`, `${visible.length + visibleDateOnly.length} events`)}</p>
    <ol className={styles.schedule}>{visible.map((event) => <li key={event.id}>
      <time dateTime={event.startsAt}>{stamp(event.startsAt, zone)}<small>{zoneLabel(zone)} · {calendarDateKey(event.startsAt, zone).slice(0, 4)}</small></time>
      <div><span className={styles.tag}>{event.kind === "earnings" ? t("決算関連", "Earnings") : t("経済指標・FOMC", "Economy & FOMC")}{now !== null && Date.parse(event.startsAt) < now ? t(" · 予定時刻を経過", " · Scheduled time passed") : t(" · 予定", " · Scheduled")}</span><h2>{event.title[lang]}</h2>{event.note && <p>{event.note[lang]}</p>}<small>{stamp(event.startsAt, otherZone)} · {zoneLabel(otherZone)}</small></div>
      <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗<span className={styles.sourceLabel}>{t("公式日程", "Official schedule")}</span></a>
    </li>)}</ol>
    {now !== null && visible.length === 0 && visibleDateOnly.length === 0 && <div className={styles.empty}><strong>{t("この条件で登録済みの予定はありません。", "No registered events match this filter.")}</strong><p>{t("発表がないという意味ではありません。期間を変更するか、公式日程をご確認ください。", "This does not mean no events are scheduled. Change the filter or check the official schedules.")}</p></div>}
    <section className={styles.section}>
      {visibleDateOnly.length > 0 && <><h2>{t("時刻未公表の決算予定", "Earnings dates awaiting a time")}</h2>
      {visibleDateOnly.map((event) => <p key={event.ticker} className={styles.notice}><strong>{event.title[lang]}</strong> · {event.date}<br />{t("公式掲載日です。時刻未公表のためET/JSTへの日付換算はしていません。", "Official calendar date; not converted to ET/JST because no time has been confirmed.")} <a href={event.sourceUrl} target="_blank" rel="noreferrer">{t("公式日程", "Official schedule")} ↗</a></p>)}</>}
      <details className={styles.coverage}>
        <summary>{t("決算の追跡対象", "Earnings coverage")} · {coverage.length}{t("社", " companies")}</summary>
        <p className={styles.description}>{t("掲載済み以外は次回日程の確認待ちです。「発表がない」という意味ではありません。予想日で埋めず、公式確認後に追加します。", "Other dates are awaiting verification, not necessarily unannounced. We add official dates rather than estimates.")}</p>
        <ul>{coverage.map((company) => <li key={company.ticker}><a href={company.sourceUrl} target="_blank" rel="noreferrer"><strong>{company.ticker}</strong> {company.name} ↗</a><small>{calendarEvents.some((event) => event.ticker === company.ticker && (now === null || Date.parse(event.startsAt) >= now)) ? t("予定掲載済み", "Schedule listed") : now !== null && selectDateOnlyEarnings("upcoming", now).some((event) => event.ticker === company.ticker) ? t("日付のみ確認", "Date confirmed; time pending") : t("次回日程を確認中", "Next date awaiting verification")}</small></li>)}</ul>
      </details>
    </section>
    <p className={styles.notice}>{t("結果・市場予想・自動通知は含みません。参加・視聴前に公式日程をご確認ください。", "Results, consensus forecasts and automatic notifications are not included. Check the official schedule before attending.")}</p>
  </ResearchToolShell>;
}
