"use client";

import Link from "next/link";
import { calendarEvents, dateOnlyEvents, calendarReviewedOn, selectCalendarEvents, selectDateOnlyEvents } from "@/lib/research/calendar";
import { filterFavoriteEvents } from "@/lib/research/favorites";
import type { Language } from "@/lib/research/data";
import { useCalendarClock } from "../use-calendar-clock";
import styles from "../research-tools.module.css";

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
  return <section className={styles.section} aria-labelledby="favorite-schedule-heading">
    <div className={styles.sectionHeading}><h2 id="favorite-schedule-heading">{t("お気に入りの決算予定", "Upcoming earnings for your favorites")}</h2><Link href="/research/calendar">{t("カレンダーへ →", "Open calendar →")}</Link></div>
    <p className={styles.description}>{t("公式予定の確認日", "Schedule checked")}: {calendarReviewedOn}</p>
    {now === null ? <p role="status">{t("予定を読み込み中…", "Loading schedule…")}</p> : <>
      {now - Date.parse(`${calendarReviewedOn}T00:00:00+09:00`) > 7 * 86400000 && <p className={styles.error}>{t("確認から7日以上経過しています。最新日程は公式ページをご確認ください。", "Checked over 7 days ago. Recheck the official schedule.")}</p>}
      <ol className={styles.schedule}>{timed.map((event) => <li key={event.id}>
        <time dateTime={event.startsAt}>{stamp(event.startsAt)}<small>{lang === "ja" ? "JST" : "ET"}</small></time>
        <div><h2>{event.title[lang]}</h2>{event.note && <p>{event.note[lang]}</p>}</div>
        <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗<span className={styles.sourceLabel}>{t("公式日程", "Official schedule")}</span></a>
      </li>)}</ol>
      {dated.length > 0 && <><h3 className={styles.description}>{t("日付のみ確認・時刻未公表", "Date confirmed; time pending")}</h3><ol className={styles.schedule}>{dated.map((event) => <li key={event.id}>
        <time dateTime={event.date}>{event.date}<small>{t("公式掲載日・時差換算なし", "Official date; no time-zone conversion")}</small></time>
        <div><h2>{event.title[lang]}</h2></div><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a>
      </li>)}</ol></>}
      {pending.length > 0 && <p className={styles.description}>{t("今後の確定予定を掲載していない銘柄", "No confirmed upcoming schedule listed")}: {pending.join(" · ")}<br />{t("予定がないという意味ではありません。公式確認後に追加します。", "This does not mean no event is scheduled. Dates are added after official verification.")}</p>}
    </>}
  </section>;
}
