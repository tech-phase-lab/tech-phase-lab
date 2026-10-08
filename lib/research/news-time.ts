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
/** A date-only release takes the time it was first seen here (same or next
 * day only), so it can show a clock like every other item. */
export function clockTime(at: string, kind: string, observedAt?: string) {
  if (kind === 'date' && observedAt) {
    const gap = Date.parse(observedAt) - Date.parse(`${at}T00:00:00Z`);
    if (gap >= 0 && gap < 48 * 3_600_000) return { at: observedAt, kind: 'observed' as string };
  }
  return { at, kind };
}
/** One clock format for the top strip: "M/D HH:MM JST" (ET in English). */
export function pulseClock(at: string, kind: string, ja: boolean, observedAt?: string) {
  const time = clockTime(at, kind, observedAt);
  return (ja ? null : usEasternTime(time.at, time.kind)) ?? shortNewsTime(time.at, time.kind);
}
