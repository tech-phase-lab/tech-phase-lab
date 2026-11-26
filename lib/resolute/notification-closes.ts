import { usMarketSession } from '../research/us-market-session.ts';
import { dayAfter, fetchDailyBatch, type DailyBar } from './twelve-daily.ts';
import { unpacedLease, type TwelveLease } from './twelve-lease.ts';
import type { DailyCloseStore } from './twelve-cache.ts';
import type { Close } from './alert-judge.ts';

// 終値アラートの価格入力。提供元は Twelve Data の日足(/time_series, interval=1day, 複数銘柄をまとめて1回)。表示は「提供: Twelve Data」。
// 営業日・休場日は米国市場カレンダー(2026〜2027のみ)で決め、範囲外は「不明」として何も送らない(推測しない)。
// 確定の扱い: 市場日の終了時刻(通常16:00 ET、短縮日13:00 ET)から30分過ぎ、かつ提供元がその日付の日足を返したときだけ isFinal。
const SETTLE_MINUTES = 30;
const EARLY_CLOSE_DATES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);
const etParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function et(at: Date) {
  const p = Object.fromEntries(etParts.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const isTradingDay = (date: string) => usMarketSession(new Date(`${date}T15:00:00Z`)) === 'regular';

/** 提供元の日足が確定していてよい、直近の米国市場日(YYYY-MM-DD)。カレンダー範囲外・見つからなければ null。 */
export function latestSettledSession(now: Date): string | null {
  if (!Number.isFinite(now.getTime()) || usMarketSession(now) === null) return null;
  const today = et(now);
  for (let back = 0; back < 12; back++) {
    const date = new Date(Date.parse(`${today.date}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
    if (usMarketSession(new Date(`${date}T15:00:00Z`)) === null) return null;
    if (!isTradingDay(date)) continue;
    if (back === 0) {
      const closeAt = (EARLY_CLOSE_DATES.has(date) ? 13 : 16) * 60 + SETTLE_MINUTES;
      if (today.minutes < closeAt) continue;
    }
    return date;
  }
  return null;
}

export type CloseSource = { marketDate: string; closes: Close[] } | { marketDate: null; closes: [] };
type Fetcher = typeof fetch;

/** Closes for a run's symbols. Once per symbol and market date for everyone: the shared copy (resolute.twelve_daily_closes, filled by the
 * daily prefetch) first; only the symbols it lacks are read from the provider, BATCH_SYMBOLS to a request, each request leased from the
 * allocator on the critical tier (alerts), never retried (a 429 or a refusal is no close: the notice state does not move and the next
 * delivery hour judges again). What the provider returns is stored for the other runs of the day. The key never appears in output. */
export function createCloseProvider(options: { apiKey: string | undefined; now?: () => Date; request?: Fetcher; baseUrl?: string; lease?: TwelveLease; store?: DailyCloseStore;
  /** Symbols whose read failed or was not granted this run (logged by the job: their members get no close and are judged next hour). */
  onUnread?: (symbols: string[]) => void }) {
  const now = options.now ?? (() => new Date());
  const lease = options.lease ?? unpacedLease();
  const memory = new Map<string, DailyBar[] | null>();
  const closeOf = (symbol: string, date: string): Close | null => {
    // 提供元が、その日付の日足を返した場合だけ。日付が違う・まだ無い場合は not final として扱う。
    const bar = memory.get(`${symbol}:${date}`)?.find(b => b.date === date);
    return bar ? { symbol, date, close: bar.close, isFinal: true } : null; // date は確定済みの市場日として選んだもの
  };
  return async function closes(symbols: string[]): Promise<CloseSource> {
    const date = latestSettledSession(now());
    if (!date) return { marketDate: null, closes: [] };
    const unique = [...new Set(symbols)];
    let missing = unique.filter(s => !memory.has(`${s}:${date}`));
    if (missing.length && options.store) {
      const stored = await options.store.read(missing, date);
      for (const [s, bars] of stored) memory.set(`${s}:${date}`, bars);
      missing = missing.filter(s => !stored.has(s));
    }
    if (missing.length) {
      const read = await fetchDailyBatch(missing, { apiKey: options.apiKey, lease, caller: 'resolute-closes', fetcher: options.request, baseUrl: options.baseUrl, outputsize: 5, endDate: dayAfter(date) });
      const answered: [string, DailyBar[]][] = [];
      for (const s of missing) {
        const bars = read.get(s) ?? null;
        memory.set(`${s}:${date}`, bars); // a failed read is not asked again in this run (one call per symbol per run at most)
        // Stored only when it holds the day's bar or the provider said there is no such series; a bar not out yet is asked again later.
        if (bars && (!bars.length || bars.some(b => b.date === date))) answered.push([s, bars]);
      }
      if (options.store && answered.length) await options.store.write(answered, date);
      const unread = missing.filter(s => read.get(s) == null);
      if (unread.length) options.onUnread?.(unread);
    }
    const out: Close[] = [];
    for (const symbol of unique) { const c = closeOf(symbol, date); if (c) out.push(c); }
    return { marketDate: date, closes: out };
  };
}
