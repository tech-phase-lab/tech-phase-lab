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

/** Mon-Fri of the week shown, as "10/26 – 10/30" (Japan time). `weeksBack` 0 is the week the notebook opens on. */
export function weekRangeLabel(now: number, weeksBack: number): string {
  const { from } = recapWindow(now - weeksBack * 7 * DAY_MS);
  const fmt = (value: number) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(value);
  return `${fmt(from + 12 * 3_600_000)} – ${fmt(from + 4 * DAY_MS + 12 * 3_600_000)}`;
}

/** A headline about an investment firm buying or selling shares (a fund adding to a stake, a manager trimming one).
 * Judged from the wording, as the feed carries no such category. */
export function isInstitutionalTrade(title: string): boolean {
  const firm = /(機関投資家|ブラックロック|バンガード|ステート・ストリート|フィデリティ|ヘッジファンド|ファンド|投資顧問|運用会社|資産運用|キャピタル|マネジメント|アドバイザーズ|パートナーズ|ウェルス|投資会社|信託)/;
  const trade = /(買い増|買い付け|買い越|買った|買う|購入|取得|売却|売った|売り越|売り出|削減|保有を|保有株|持ち株|持株|株式を|株を)/;
  const firmEn = /\b(Capital|Management|Advisors?|Partners|Wealth|Investments?|Asset|Fund|Trust|Holdings|LLC|LP|Securities)\b/;
  const tradeEn = /\b(acquires?|acquired|buys?|bought|sells?|sold|purchases?|purchased|boosts?|lifts?|raises?|trims?|cuts?|lowers?|reduces?|adds?|increases?|decreases?|invests?|takes?)\b.*\b(shares?|stake|position|holdings?)\b/i;
  return (firm.test(title) && trade.test(title)) || (firmEn.test(title) && tradeEn.test(title));
}

export type NotebookEarnings = { ticker: string; title: string; at: string; facts: string[] };
export type NotebookTarget = { ticker: string; firm: string; previous: number; latest: number; at: string };
export type NotebookNews = { ticker: string; title: string; at: string; /** An investment firm buying or selling shares: shown as one line per day. */ institutional: boolean };
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
    for (const ticker of row.tickers) if (mine.has(ticker) && !earnings.has(ticker)) earnings.set(ticker, { ticker, title: row.title, at: row.at, facts: row.facts ?? [] });
  }
  // A result the feed has not reached yet is still on the calendar once its time has passed.
  for (const event of input.events) {
    if (event.kind !== "earnings" || !event.ticker || !mine.has(event.ticker) || earnings.has(event.ticker)) continue;
    if (inWeek(Date.parse(event.startsAt))) earnings.set(event.ticker, { ticker: event.ticker, title: event.title[lang], at: event.startsAt, facts: [] });
  }

  const targets = input.targets
    .filter(target => mine.has(target.ticker) && inWeek(Date.parse(target.publishedAt)))
    .map(target => ({ ticker: target.ticker, firm: target.firm, previous: target.previous, latest: target.latest, at: target.publishedAt }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const news = input.rows
    .filter(row => row.kind === "news" && inWeek(flashInstant(row)))
    .flatMap(row => row.tickers.filter(ticker => mine.has(ticker)).map(ticker => ({ ticker, title: row.title, at: row.at, institutional: isInstitutionalTrade(row.title) })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return { since, previous, earnings: [...earnings.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), targets, news };
}
