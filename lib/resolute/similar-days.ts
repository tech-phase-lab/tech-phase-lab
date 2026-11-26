import type { DailyClose } from './thermometer.ts';

/** 今夜のひと息「今日と似た日」(owner, Nov 25). Pure functions over a TP basket's daily levels (thermometer-basket.ts): no I/O.
 * Every number is counted from the levels; nothing is estimated.
 *
 * Similar day: a session in the 10 calendar years before tonight's session whose one-day move has the same sign and a size
 * within ±band points of tonight's move. band = 20% of tonight's move, at least 0.5 and at most 1.5 points (−7.5% → −9.0%〜−6.0%;
 * −3.0% → −3.6%〜−2.4%; −1.0% → −1.5%〜−0.5%). Moves smaller than 0.1 points in size are never matched.
 * Recovered ("元の高さに戻った"): the first later close above the close of the session before the similar day. The time to recover
 * is counted in calendar days from the similar day to that close. No such close yet: not recovered (「まだ戻っていない」).
 * Up nights: instead of recovery, the move from the similar day's close to the close 21 sessions later (about one month).
 */
export const SIMILAR_YEARS = 10;
export const MONTH_SESSIONS = 21;
export type SimilarDay = { date: string; changePercent: number; recoveredOn: string | null; days: number | null; monthAfterPercent: number | null };
export type SimilarHistory = {
  date: string; changePercent: number; direction: 'down' | 'up';
  low: number; high: number; from: string;
  count: number;
  /** Down nights. */
  recovered: number; minDays: number | null; maxDays: number | null;
  /** Up nights: similar days with a full month after them, how many were higher a month later, the range of those moves. */
  monthCount: number; higherAfterMonth: number; monthMin: number | null; monthMax: number | null;
  /** Newest first, at most three. */
  recent: SimilarDay[];
};
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
export function similarBand(move: number): { low: number; high: number } {
  const size = Math.abs(move), width = Math.min(1.5, Math.max(0.5, size * 0.2));
  const a = round(Math.max(0.1, size - width)), b = round(size + width);
  return move < 0 ? { low: -b, high: -a } : { low: a, high: b };
}
function tenYearsBefore(date: string) { const d = new Date(`${date}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - SIMILAR_YEARS); return d.toISOString().slice(0, 10); }
const dayGap = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
function sortedLevels(levels: readonly DailyClose[], session: string) {
  return levels.filter(bar => bar.date <= session && Number.isFinite(bar.close) && bar.close > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
}
/** Tonight's session and its one-day move, from the same levels. Null without the session and the session before it. */
export function similarDays(levels: readonly DailyClose[], session: string): SimilarHistory | null {
  const bars = sortedLevels(levels, session);
  const last = bars.length - 1;
  if (last < 1 || bars[last].date !== session) return null;
  const move = 100 * (bars[last].close / bars[last - 1].close - 1);
  if (!Number.isFinite(move) || Math.abs(move) < 0.1) return null;
  const from = tenYearsBefore(session);
  if (bars[0].date > from) return null; // not ten full years of levels: never a shorter history
  const { low, high } = similarBand(move);
  const direction = move < 0 ? 'down' as const : 'up' as const;
  const days: SimilarDay[] = [];
  for (let i = 1; i < last; i++) {
    if (bars[i].date < from) continue;
    const change = 100 * (bars[i].close / bars[i - 1].close - 1);
    if (!(change >= low && change <= high)) continue;
    let recoveredOn: string | null = null;
    for (let k = i + 1; k <= last; k++) if (bars[k].close > bars[i - 1].close) { recoveredOn = bars[k].date; break; }
    const after = i + MONTH_SESSIONS <= last ? 100 * (bars[i + MONTH_SESSIONS].close / bars[i].close - 1) : null;
    days.push({ date: bars[i].date, changePercent: round(change, 2), recoveredOn, days: recoveredOn ? dayGap(bars[i].date, recoveredOn) : null, monthAfterPercent: after === null ? null : round(after) });
  }
  const recoveredDays = days.flatMap(d => d.days === null ? [] : [d.days]);
  const month = days.flatMap(d => d.monthAfterPercent === null ? [] : [d.monthAfterPercent]);
  return {
    date: session, changePercent: round(move, 2), direction, low, high, from,
    count: days.length,
    recovered: recoveredDays.length, minDays: recoveredDays.length ? Math.min(...recoveredDays) : null, maxDays: recoveredDays.length ? Math.max(...recoveredDays) : null,
    monthCount: month.length, higherAfterMonth: month.filter(v => v > 0).length, monthMin: month.length ? Math.min(...month) : null, monthMax: month.length ? Math.max(...month) : null,
    recent: days.slice(-3).reverse(),
  };
}

/** First open (owner, Nov 25): the past big falls in the ten years and how long each took to get back to where it started.
 * A fall is counted from a closing high once the basket closes BIG_DROP_PERCENT or more below it; it starts at that high and
 * recovers on the first later close above the high. No fall size is kept (the page shows only the time to recover). */
export const BIG_DROP_PERCENT = 15;
export type BigDrop = { peak: string; trough: string; recoveredOn: string | null; days: number | null };
export function bigDrops(levels: readonly DailyClose[], session: string): BigDrop[] | null {
  const bars = sortedLevels(levels, session), from = tenYearsBefore(session);
  if (!bars.length || bars[0].date > from) return null;
  const out: BigDrop[] = [];
  let peak = bars.findIndex(bar => bar.date >= from);
  if (peak < 0) return null;
  let trough = peak, deep = false;
  for (let i = peak + 1; i < bars.length; i++) {
    if (bars[i].close > bars[peak].close) {
      if (deep) out.push({ peak: bars[peak].date, trough: bars[trough].date, recoveredOn: bars[i].date, days: dayGap(bars[peak].date, bars[i].date) });
      peak = i; trough = i; deep = false; continue;
    }
    if (bars[i].close < bars[trough].close) trough = i;
    if (100 * (1 - bars[trough].close / bars[peak].close) >= BIG_DROP_PERCENT) deep = true;
  }
  if (deep) out.push({ peak: bars[peak].date, trough: bars[trough].date, recoveredOn: null, days: null });
  return out;
}

/** Names for days and falls everyone knows. Only these get a name; any other day is shown by its date alone. */
const NAMED: [string, string, { ja: string; en: string }][] = [
  ['2025-04-09', '2025-04-09', { ja: '関税の一時停止', en: 'Tariff pause' }],
  ['2025-03-28', '2025-05-30', { ja: '関税ショック', en: 'Tariff shock' }],
  ['2025-01-27', '2025-01-27', { ja: 'DeepSeekショック', en: 'DeepSeek shock' }],
  ['2024-07-17', '2024-08-09', { ja: '世界同時株安', en: 'Global sell-off' }],
  ['2023-03-09', '2023-03-17', { ja: '米銀行の破綻', en: 'US bank failures' }],
  ['2022-11-10', '2022-11-10', { ja: '米CPIの鈍化', en: 'Softer US inflation' }],
  ['2022-01-01', '2022-12-31', { ja: 'インフレと利上げ', en: 'Inflation and rate hikes' }],
  ['2020-02-20', '2020-04-30', { ja: 'コロナショック', en: 'COVID crash' }],
  ['2018-10-01', '2018-12-31', { ja: '米利上げ懸念', en: 'Fed tightening fears' }],
  ['2018-02-01', '2018-02-28', { ja: 'VIXショック', en: 'Volatility shock' }],
];
export function eventName(date: string, locale: 'ja' | 'en'): string | null {
  for (const [from, to, name] of NAMED) if (date >= from && date <= to) return name[locale];
  return null;
}
/** 「2025年4月 関税ショック」 for a named day, 「2025年4月9日」 otherwise. */
export function dayLabel(date: string, locale: 'ja' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number), name = eventName(date, locale);
  if (locale === 'en') {
    const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return name ? `${month} ${y} · ${name}` : `${month} ${d}, ${y}`;
  }
  return name ? `${y}年${m}月 ${name}` : `${y}年${m}月${d}日`;
}
/** Calendar days as words: 「3日」「約2週間」「約3か月」「約1年」「約1年4か月」. */
export function periodLabel(days: number, locale: 'ja' | 'en'): string {
  const en = locale === 'en';
  if (days < 14) return en ? `${days} day${days === 1 ? '' : 's'}` : `${days}日`;
  if (days < 30) { const w = Math.round(days / 7); return en ? `about ${w} weeks` : `約${w}週間`; }
  const months = Math.round(days / 30.44);
  if (months < 12) return en ? `about ${months} month${months === 1 ? '' : 's'}` : `約${months}か月`;
  const y = Math.floor(months / 12), r = months % 12;
  if (en) return `about ${y} year${y === 1 ? '' : 's'}${r ? ` ${r} month${r === 1 ? '' : 's'}` : ''}`;
  return `約${y}年${r ? `${r}か月` : ''}`;
}
/** 「約1か月〜1年」: the shortest and longest time to recover. */
export function periodRange(min: number, max: number, locale: 'ja' | 'en'): string {
  const a = periodLabel(min, locale), b = periodLabel(max, locale);
  if (a === b) return a;
  return locale === 'en' ? `${a} to ${a.startsWith('about ') ? b.replace(/^about /, '') : b}` : `${a}〜${a.startsWith('約') ? b.replace(/^約/, '') : b}`;
}
