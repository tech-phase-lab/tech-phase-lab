import type { Language } from "./data";
import type { CalendarEvent } from "./calendar.ts";
import type { PriceTarget } from "./price-targets.ts";
import { flashInstant, type FlashRow } from "./flash-rows.ts";

/** 銘柄手帳: what moved for the stocks a reader watches since this week began (Monday 00:00 Japan time).
 * FREE sees the counts; PRO and the owner see what is behind them. Built only from what the site already collects. */
const JST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** Monday 00:00 Japan time on or before `now`, as an instant. */
export function weekStart(now: number): number {
  const jst = new Date(now + JST_OFFSET_MS);
  const sinceMonday = (jst.getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - sinceMonday) - JST_OFFSET_MS;
}

/** Monday and Tuesday (Japan time) show the week that just ended in full, because the new week has hardly begun;
 * from Wednesday the notebook is this week so far, and by the weekend it is the whole week. */
export function recapWindow(now: number): { from: number; to: number; previous: boolean } {
  const start = weekStart(now);
  const weekday = (new Date(now + JST_OFFSET_MS).getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  return weekday <= 1 ? { from: start - 7 * DAY_MS, to: start - 1, previous: true } : { from: start, to: now, previous: false };
}

export function weekLabel(now: number, lang: Language): string {
  const { from, to } = recapWindow(now);
  const fmt = (value: number) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(value);
  return `${fmt(from)}〜${fmt(to)}`;
}

export type NotebookEarnings = { ticker: string; title: string; at: string };
export type NotebookTarget = { ticker: string; firm: string; previous: number; latest: number; at: string };
export type NotebookNews = { ticker: string; title: string; at: string };
export type Notebook = { since: number; previous: boolean; earnings: NotebookEarnings[]; targets: NotebookTarget[]; news: NotebookNews[] };

export function buildNotebook(input: {
  tickers: readonly string[]; now: number; lang: Language;
  rows: readonly FlashRow[]; targets: readonly PriceTarget[]; events: readonly CalendarEvent[];
}): Notebook {
  const { now, lang } = input;
  const { from: since, to, previous } = recapWindow(now);
  const mine = new Set(input.tickers);
  const inWeek = (instant: number) => Number.isFinite(instant) && instant >= since && instant <= to;

  const earnings = new Map<string, NotebookEarnings>();
  for (const row of input.rows) {
    if (row.kind !== "earnings" || !inWeek(flashInstant(row))) continue;
    for (const ticker of row.tickers) if (mine.has(ticker) && !earnings.has(ticker)) earnings.set(ticker, { ticker, title: row.title, at: row.at });
  }
  // A result the feed has not reached yet is still on the calendar once its time has passed.
  for (const event of input.events) {
    if (event.kind !== "earnings" || !event.ticker || !mine.has(event.ticker) || earnings.has(event.ticker)) continue;
    if (inWeek(Date.parse(event.startsAt))) earnings.set(event.ticker, { ticker: event.ticker, title: event.title[lang], at: event.startsAt });
  }

  const targets = input.targets
    .filter(target => mine.has(target.ticker) && inWeek(Date.parse(target.publishedAt)))
    .map(target => ({ ticker: target.ticker, firm: target.firm, previous: target.previous, latest: target.latest, at: target.publishedAt }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const news = input.rows
    .filter(row => row.kind === "news" && inWeek(flashInstant(row)))
    .flatMap(row => row.tickers.filter(ticker => mine.has(ticker)).map(ticker => ({ ticker, title: row.title, at: row.at })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return { since, previous, earnings: [...earnings.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), targets, news };
}
