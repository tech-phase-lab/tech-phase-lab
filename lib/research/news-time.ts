import type { OfficialUpdate } from './general-news';
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
export function shortNewsTime(at: string, kind: string) {
  if (kind === 'date') { const [, month, day] = at.split('-'); return `${Number(month)}/${Number(day)}`; }
  return new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at)).replace(',', '') + ' JST';
}
/** The same instant in U.S. Eastern time (EDT/EST handled by the time zone). */
export function usEasternTime(at: string, kind: string) {
  if (kind === 'date') return null;
  return new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at)).replace(',', '') + ' ET';
}
/** The time a card shows is only ever the source's own: a publication time, or
 * for a date-only release just that date. The time this system first saw an
 * item is never shown as if it were the publication time (owner, Oct 10: a
 * story with no stated time was listed as 21:44, which was only when it was
 * found). Items with no source time at all are not listed (see officialTime). */
// The third argument is kept so existing callers need no change; it is ignored.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function clockTime(at: string, kind: string, _observedAt?: string) {
  return { at, kind };
}
/** One clock format for the top strip: "M/D HH:MM JST" (ET in English). */
export function pulseClock(at: string, kind: string, ja: boolean, observedAt?: string) {
  const time = clockTime(at, kind, observedAt);
  return (ja ? null : usEasternTime(time.at, time.kind)) ?? shortNewsTime(time.at, time.kind);
}
