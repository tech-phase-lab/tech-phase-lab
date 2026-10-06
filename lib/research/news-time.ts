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
/** One clock format for the top strip. A date-only release shows the time it
 * was first seen here (same or next day only), so every line reads "M/D HH:MM JST|ET". */
export function pulseClock(at: string, kind: string, ja: boolean, observedAt?: string) {
  let instant = at, instantKind = kind;
  if (kind === 'date' && observedAt) {
    const gap = Date.parse(observedAt) - Date.parse(`${at}T00:00:00Z`);
    if (gap >= 0 && gap < 48 * 3_600_000) { instant = observedAt; instantKind = 'observed'; }
  }
  return (ja ? null : usEasternTime(instant, instantKind)) ?? shortNewsTime(instant, instantKind);
}
