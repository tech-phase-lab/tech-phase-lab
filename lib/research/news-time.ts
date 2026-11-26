import type { OfficialUpdate } from './general-news';
import { formatDisplay, zoneLabel, type DisplayLang } from './display-time.ts';
/** An X post ID carries the moment it was posted. Re-fetching an old post
 * must never make it look new (NBIS Platinum, posted Sep 23, resurfaced Oct 8). */
export function xPostedAt(url: string) {
  const id = /^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/(\d{15,20})/.exec(url)?.[1];
  if (!id) return null;
  const at = Number(BigInt(id) >> BigInt(22)) + 1288834974657;
  return at > Date.UTC(2020, 0, 1) ? at : null;
}
export function officialTime(item: OfficialUpdate) {
  const posted = xPostedAt(item.url);
  const stated = Date.parse(item.publishedAt ?? item.publishedOn ?? item.observedAt);
  if (posted !== null && !(stated <= posted + 6 * 3_600_000)) return { at: new Date(posted).toISOString(), kind: 'published' as const };
  if (item.publishedAt) return { at: item.publishedAt, kind: 'published' as const };
  if (item.publishedOn) return { at: item.publishedOn, kind: 'date' as const };
  return { at: item.observedAt, kind: 'observed' as const };
}
/** A release whose source states only its day, first seen by the monitor within that day: the first-seen instant, so the
 * row can show an hour and minute (labelled 取得 / Found) and sort inside its day (owner, Nov 26: "何時に起きたのかさっぱり分からん"). The window
 * allows for every time zone the stated day can be in (UTC+14 to UTC-12) and a short collection delay; a release found
 * later than that (an old release found again) keeps just its date. Publication times stated by the feed or the article
 * page are collected first (monitor publishedAt); this is only the fallback for sources that state no time at all. */
const FIRST_SEEN_BEFORE_DAY_MS = 14 * 3_600_000;
const FIRST_SEEN_AFTER_DAY_MS = 36 * 3_600_000;
export function firstSeenOnDay(date: string, observedAt?: string | null): string | null {
  if (!observedAt || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = Date.parse(`${date}T00:00:00Z`), seen = Date.parse(observedAt);
  if (!Number.isFinite(day) || !Number.isFinite(seen)) return null;
  return seen >= day - FIRST_SEEN_BEFORE_DAY_MS && seen <= day + FIRST_SEEN_AFTER_DAY_MS ? new Date(seen).toISOString() : null;
}
/** News older than three days is not picked up as new (owner, Oct 8). */
export const NEWS_MAX_AGE_MS = 72 * 3_600_000;
/** Found more than 30 minutes after it was published: shown with its real
 * time, never marked NEW (owner, Oct 8). */
export function lateDetection(at: string, observedAt?: string) {
  return !!observedAt && Date.parse(observedAt) - Date.parse(at) > 30 * 60_000;
}
export function recentPublication(at: string, kind: string, now: number) {
  const age = now - Date.parse(at);
  return kind === 'published' && Number.isFinite(age) && age >= 0 && age < 3_600_000;
}
/** "M/D HH:MM JST" / "M/D HH:MM ET" in the site's zone (owner, Nov 17). */
export function newsTime(at: string, lang: DisplayLang) {
  return `${formatDisplay(at, lang, {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}, 'en-US').replace(',', '')} ${zoneLabel(lang)}`;
}
export function shortNewsTime(at: string, kind: string) {
  if (kind === 'date') { const [, month, day] = at.split('-'); return `${Number(month)}/${Number(day)}`; }
  return newsTime(at, 'ja');
}
/** The same instant in U.S. Eastern time (EDT/EST handled by the time zone). */
export function usEasternTime(at: string, kind: string) {
  if (kind === 'date') return null;
  return newsTime(at, 'en');
}
/** The time a card shows is only ever the source's own: a publication time, or
 * for a date-only release just that date. The time this system first saw an
 * item is never shown as if it were the publication time (owner, Oct 10: a
 * story with no stated time was listed as 21:44, which was only when it was
 * found). Items with no source time at all are not listed (see officialTime).
 * The 速報 timeline gives a date-only release the time it was first seen on that day (firstSeenOnDay, owner Nov 26:
 * a row with no clock left readers unable to tell when it happened); that time is always labelled 取得 / Found, as on
 * the company timeline, so it is never shown as if it were the publication time. */
// The third argument is kept so existing callers need no change; it is ignored.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function clockTime(at: string, kind: string, _observedAt?: string) {
  return { at, kind };
}
/** One clock format for the top strip: "M/D HH:MM", Japan time in Japanese and U.S. Eastern in English, with no zone suffix (owner, Oct 15). */
export function pulseClock(at: string, kind: string, ja: boolean, observedAt?: string) {
  const time = clockTime(at, kind, observedAt);
  return ((ja ? null : usEasternTime(time.at, time.kind)) ?? shortNewsTime(time.at, time.kind)).replace(/ (?:JST|ET)$/, "");
}
