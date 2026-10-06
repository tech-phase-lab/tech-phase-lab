import type { OfficialUpdate } from './general-news';
export function officialTime(item: OfficialUpdate) {
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
