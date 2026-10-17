"use client";

import Link from "next/link";
import { calendarEvents, dateOnlyEvents, calendarReviewedOn, selectCalendarEvents, selectDateOnlyEvents } from "@/lib/research/calendar";
import { filterFavoriteEvents } from "@/lib/research/favorites";
import type { Language } from "@/lib/research/data";
import { useCalendarClock } from "../use-calendar-clock";
import styles from "./watchlist.module.css";

export default function FavoriteSchedule({ favorites, lang }: { favorites: string[]; lang: Language }) {
  const now = useCalendarClock();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const zone = lang === "ja" ? "Asia/Tokyo" : "America/New_York";
  const timed = now === null ? [] : selectCalendarEvents(filterFavoriteEvents(calendarEvents, favorites, false), "earnings", "upcoming", now, zone);
  const dated = now === null ? [] : selectDateOnlyEvents(filterFavoriteEvents(dateOnlyEvents, favorites, false), "earnings", "upcoming", now);
  const covered = new Set([...timed, ...dated].map((event) => event.ticker));
  const pending = favorites.filter((ticker) => !covered.has(ticker));
  const stamp = (value: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  if (!favorites.length) return null;
  return <section className={styles.schedule} aria-labelledby="favorite-schedule-heading">
    <div className={styles.scheduleHeading}><h2 id="favorite-schedule-heading">{t("次の決算", "Upcoming earnings")}</h2><Link href="/research/calendar">{t("カレンダー →", "Calendar →")}</Link></div>
    {now === null ? <p role="status" className={styles.scheduleNote}>{t("予定を読み込み中…", "Loading schedule…")}</p> : <>
      {now - Date.parse(`${calendarReviewedOn}T00:00:00+09:00`) > 7 * 86400000 && <p className={styles.error}>{t("日程の確認から7日以上経過しています。", "Schedules were checked over 7 days ago.")}</p>}
      {timed.length + dated.length === 0 && <p className={styles.scheduleNote}>{t("次回の日程は未確認です", "Next earnings dates are not yet confirmed")}</p>}
      <ol className={styles.scheduleList}>{timed.map((event) => <li key={event.id}>
        <time dateTime={event.startsAt}>{stamp(event.startsAt)}<small>{lang === "ja" ? "JST" : "ET"}</small></time>
        <h3>{event.title[lang]}</h3>
        <a href={event.sourceUrl} target="_blank" rel="noreferrer" aria-label={t(`${event.ticker}の公式決算日程`, `Official ${event.ticker} earnings schedule`)}>{t("公式日程 ↗", "Official ↗")}</a>
      </li>)}{dated.map((event) => <li key={event.id}>
        <time dateTime={event.date}>{event.date}<small>{t("時刻未公表・現地日付", "Local date; time pending")}</small></time>
        <h3>{event.title[lang]}</h3><a href={event.sourceUrl} target="_blank" rel="noreferrer" aria-label={t(`${event.ticker}の公式決算日程`, `Official ${event.ticker} earnings schedule`)}>{t("公式日程 ↗", "Official ↗")}</a>
      </li>)}</ol>
      <details className={styles.scheduleDetails}><summary>{t("日程の確認状況", "Schedule details")}</summary>
        <p>{t("公式予定の確認日", "Schedule checked")}: {calendarReviewedOn}</p>
        {pending.length > 0 && <p>{t("次回日程未確認", "Next date unconfirmed")}: {pending.join(" · ")}</p>}
        {timed.filter(event => event.note).map(event => <p key={event.id}>{event.ticker}: {event.note?.[lang]}</p>)}
      </details>
    </>}
  </section>;
}
