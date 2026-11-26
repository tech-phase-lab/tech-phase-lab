/** 銘柄検索「今日の注目」/ "In focus today" (owner, Nov 26): six stocks of the last regular session, computed on the server into one shared
 * daily snapshot (lib/research/search-focus-server.ts) that the site's minute job keeps. No server-only / Next imports so the rules can be
 * tested directly.
 *
 * - Candidates: every stock of the search's 17 themes, every company the site tracks for 速報 and earnings (providers.json), and any stock
 *   that reported earnings or appeared in 速報 that day.
 * - Volume multiple: the session's volume ÷ the average volume of the 20 sessions before it, from the same daily bars the stock pages read.
 * - A stock qualifies when it reported earnings that day, appeared in 速報 that day, or traded at least 2× its average volume.
 * - The six largest multiples among those; fewer than six are filled with the largest absolute day changes. */
import type { Bar } from "./market-quote.ts";

export const FOCUS_ROWS = 6;
export const FOCUS_MIN_MULTIPLE = 2;
export const FOCUS_AVERAGE_SESSIONS = 20;
/** Daily bars asked per stock: the session, the 20 before it, and the close before those (= its previous close when the session's own
 * bar is still missing). */
export const FOCUS_BARS = FOCUS_AVERAGE_SESSIONS + 2;
/** A session's daily bar is taken as final this long after the 16:00 ET close (the closing auction's prints are in by then). */
export const CLOSE_SETTLED_MINUTES = 16 * 60 + 15;

/** One stock's figures for its last completed session. */
export type FocusStat = { date: string; close: number; change: number | null; volume: number | null; average: number | null; multiple: number | null };
export type FocusFlags = { earnings: string[]; flash: string[] };
export type FocusRow = { ticker: string; name: string; change: number | null; multiple: number | null; earnings: boolean; flash: boolean };

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function etParts(now: number) {
  const p = Object.fromEntries(ET.formatToParts(new Date(now)).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
/** The New York date of an instant ("2026-11-25"); a date-only text is returned as it is. */
export function etDate(at: string | number): string {
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const t = typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(t) ? etParts(t).date : "";
}
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekend = (date: string) => { const d = new Date(`${date}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };

/** The last weekday whose close has settled: the session the snapshot should hold. A market holiday is a weekday too: its bars simply end
 * the session before, and the snapshot is not read again until the next session settles. */
export function settledSession(now: number): string {
  const { date, minutes } = etParts(now);
  let day = minutes >= CLOSE_SETTLED_MINUTES ? date : shiftDay(date, -1);
  while (weekend(day)) day = shiftDay(day, -1);
  return day;
}

/** The figures of the last completed session in a daily series (newest first or oldest first). A bar of `session`'s day or later is used
 * only once that session has settled (`settled`); the provider's bar of a day still trading would give a partial volume. */
export function focusStat(bars: Bar[], settled: string): FocusStat | null {
  const daily = bars.filter(bar => /^\d{4}-\d{2}-\d{2}/.test(bar.at) && bar.at.slice(0, 10) <= settled && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => b.at.localeCompare(a.at));
  const [last, previous] = daily;
  if (!last) return null;
  const before = daily.slice(1, 1 + FOCUS_AVERAGE_SESSIONS).map(bar => bar.volume).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  const average = before.length === FOCUS_AVERAGE_SESSIONS ? before.reduce((sum, v) => sum + v, 0) / FOCUS_AVERAGE_SESSIONS : null;
  const volume = typeof last.volume === "number" && Number.isFinite(last.volume) ? last.volume : null;
  return {
    date: last.at.slice(0, 10), close: last.close,
    change: previous ? Math.round((last.close / previous.close - 1) * 10_000) / 100 : null,
    volume, average: average === null ? null : Math.round(average),
    multiple: volume !== null && average ? Math.round((volume / average) * 100) / 100 : null,
  };
}

/** The session the snapshot shows: the newest date most stocks have (one stock's stray bar cannot move it). */
export function focusSession(stats: Record<string, FocusStat>): string | null {
  const count = new Map<string, number>();
  for (const stat of Object.values(stats)) count.set(stat.date, (count.get(stat.date) ?? 0) + 1);
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const dates = [...count.keys()].sort().reverse();
  const common = [...dates].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))[0] ?? null;
  return dates.find(date => (count.get(date) ?? 0) * 2 >= total) ?? common;
}

/** The six stocks (owner, Nov 26). Only stocks of `session` take part; `names` gives the row's company name. */
export function rankFocus(stats: Record<string, FocusStat>, flags: FocusFlags, session: string | null, names: (ticker: string) => string): FocusRow[] {
  if (!session) return [];
  const earnings = new Set(flags.earnings), flash = new Set(flags.flash);
  const rows: FocusRow[] = Object.entries(stats).filter(([, stat]) => stat.date === session)
    .map(([ticker, stat]) => ({ ticker, name: names(ticker), change: stat.change, multiple: stat.multiple, earnings: earnings.has(ticker), flash: flash.has(ticker) }));
  const byMultiple = (a: FocusRow, b: FocusRow) => (b.multiple ?? -1) - (a.multiple ?? -1) || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.ticker.localeCompare(b.ticker);
  const qualified = rows.filter(row => row.earnings || row.flash || (row.multiple ?? 0) >= FOCUS_MIN_MULTIPLE).sort(byMultiple).slice(0, FOCUS_ROWS);
  const taken = new Set(qualified.map(row => row.ticker));
  const movers = rows.filter(row => !taken.has(row.ticker) && row.change !== null)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!) || a.ticker.localeCompare(b.ticker));
  return [...qualified, ...movers].slice(0, FOCUS_ROWS);
}

/** Tickers with earnings on `session` (New York date): the site's calendar (a dated or a date-only entry) and the results feed. */
export function earningsOn(session: string, sources: {
  calendar?: { kind: string; ticker?: string; startsAt: string }[];
  dateOnly?: { kind: string; ticker?: string; date: string }[];
  results?: { kind: string; ticker: string; publishedAt: string }[];
}): string[] {
  const out = new Set<string>();
  for (const event of sources.calendar ?? []) if (event.kind === "earnings" && event.ticker && etDate(event.startsAt) === session) out.add(event.ticker);
  for (const event of sources.dateOnly ?? []) if (event.kind === "earnings" && event.ticker && event.date === session) out.add(event.ticker);
  for (const brief of sources.results ?? []) if (brief.kind === "earnings" && brief.ticker && etDate(brief.publishedAt) === session) out.add(brief.ticker);
  return [...out].filter(validTicker).sort();
}

/** Tickers of 速報 rows (lib/research/flash-rows.ts) dated `session` (New York date). Earnings rows count as earnings as well. */
export function flashOn(session: string, rows: { kind: string; tickers: string[]; at: string; timeKind: string }[]): FocusFlags {
  const flash = new Set<string>(), earnings = new Set<string>();
  for (const row of rows) {
    if ((row.timeKind === "date" ? row.at : etDate(row.at)) !== session) continue;
    for (const ticker of row.tickers) { flash.add(ticker); if (row.kind === "earnings") earnings.add(ticker); }
  }
  return { flash: [...flash].filter(validTicker).sort(), earnings: [...earnings].filter(validTicker).sort() };
}

export const validTicker = (ticker: string) => /^[A-Z][A-Z0-9.]{0,6}$/.test(ticker);

/** The stocks still to be read for `settled`: never read for it, and not tried in the last `retryMs`. */
export function focusDue(candidates: readonly string[], read: Record<string, string>, tried: Record<string, number>, settled: string, now: number, retryMs = 20 * 60_000): string[] {
  return candidates.filter(ticker => read[ticker] !== settled && now - (tried[ticker] ?? -Infinity) >= retryMs);
}

/** "11/25 終値" / "Nov 25 close". */
export function closeLabel(session: string, lang: "ja" | "en"): string {
  const [, month, day] = session.split("-").map(Number);
  if (lang === "ja") return `${month}/${day} 終値`;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${session}T12:00:00Z`))} ${day} close`;
}
