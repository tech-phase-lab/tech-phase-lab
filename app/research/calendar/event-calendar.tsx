"use client";

import { useState, useSyncExternalStore } from "react";
import { calendarDateKey, calendarEvents, calendarReviewedOn, selectCalendarEvents, type CalendarEvent } from "@/lib/research/calendar";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import styles from "../research-tools.module.css";

function subscribeClock(notify: () => void) {
  const timer = window.setInterval(notify, 60000);
  document.addEventListener("visibilitychange", notify);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", notify); };
}
function clockSnapshot() { return Math.floor(Date.now() / 60000) * 60000; }
const months = [...new Set(calendarEvents.map((event) => calendarDateKey(event.startsAt).slice(0, 7)))];

export default function EventCalendar() {
  const [lang, setLang] = useResearchLanguage();
  const [kind, setKind] = useState<"all" | CalendarEvent["kind"]>("all");
  const [period, setPeriod] = useState("upcoming");
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const visible = now === null ? [] : selectCalendarEvents(calendarEvents, kind, period, now);
  const stale = now !== null && now - Date.parse(`${calendarReviewedOn}T00:00:00+09:00`) > 7 * 86400000;
  const stamp = (value: string, zone: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("決算・経済指標カレンダー", "Earnings & economic calendar")} description={t("公式発表で確認した予定を、日本時間で。", "Officially scheduled events, shown in Japan time.")}>
    <p className={styles.notice}>{t("公式予定の確認日", "Schedule checked")}: {calendarReviewedOn} · {t("手動更新・主な予定のみ。変更される場合があります。", "Manually updated, selected events only. Dates may change.")}</p>
    {stale && <p role="status" className={styles.error}>{t("確認から7日以上経過しています。参加・視聴前に公式日程を再確認してください。", "This schedule was checked over 7 days ago. Recheck the official source before attending.")}</p>}
    <div className={styles.filters}>
      <div role="group" aria-label={t("予定の種類", "Event category")}>{(["all", "earnings", "economic"] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "all" ? t("すべて", "All") : value === "earnings" ? t("決算", "Earnings") : t("経済指標・FOMC", "Economy & FOMC")}</button>)}</div>
      <label>{t("期間（日本時間）", "Period (Japan time)")}<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="upcoming">{t("今後の予定", "Upcoming")}</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
    </div>
    <p className={styles.description}>{t("表示時刻は日本時間（JST）。米国の夏時間・冬時間を反映しています。", "Times are JST (Japan). U.S. daylight-saving changes are accounted for.")}</p>
    <p aria-live="polite" className={styles.description}>{now === null ? t("予定を読み込み中…", "Loading schedule…") : t(`${visible.length}件の予定`, `${visible.length} events`)}</p>
    <ol className={styles.schedule}>{visible.map((event) => <li key={event.id}>
      <time dateTime={event.startsAt}>{stamp(event.startsAt, "Asia/Tokyo")}<small>JST · {calendarDateKey(event.startsAt).slice(0, 4)}</small></time>
      <div><span className={styles.tag}>{event.kind === "earnings" ? t("決算説明会", "Earnings call") : t("経済指標・FOMC", "Economy & FOMC")}{now !== null && Date.parse(event.startsAt) < now ? t(" · 予定時刻を経過", " · Scheduled time passed") : t(" · 予定", " · Scheduled")}</span><h2>{event.title[lang]}</h2>{event.note && <p>{event.note[lang]}</p>}<small>{t("現地時刻", "Source local time")}: {stamp(event.startsAt, event.sourceTimezone)} · {event.sourceTimezone === "America/Denver" ? t("米国山岳部時間", "U.S. Mountain Time") : t("米国東部時間", "U.S. Eastern Time")}</small></div>
      <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗<span className={styles.sourceLabel}>{t("公式日程", "Official schedule")}</span></a>
    </li>)}</ol>
    {now !== null && visible.length === 0 && <div className={styles.empty}><strong>{t("この条件で登録済みの予定はありません。", "No registered events match this filter.")}</strong><p>{t("発表がないという意味ではありません。期間を変更するか、公式日程をご確認ください。", "This does not mean no events are scheduled. Change the filter or check the official schedules.")}</p></div>}
    <p className={styles.notice}>{t("決算は現在MUの説明会予定を収録。他銘柄は公式確認後に追加します。結果・市場予想・自動通知は含みません。", "Earnings coverage currently includes the MU call. Other companies will be added after official verification. Results, consensus forecasts, and automatic notifications are not included.")}</p>
  </ResearchToolShell>;
}
