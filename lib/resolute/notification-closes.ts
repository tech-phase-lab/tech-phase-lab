import { usMarketSession } from '../research/us-market-session.ts';
import { parseBars } from '../research/market-quote.ts';
import type { Close } from './alert-judge.ts';

// 終値アラートの価格入力。提供元は Twelve Data の日足(/time_series, interval=1day)。表示は「提供: Twelve Data」。
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

/** 1回の実行で同じ銘柄を二度取りに行かない(ユーザーごとのループでも提供元の呼び出しは銘柄数だけ)。キーは出力に出さない。 */
export function createCloseProvider(options: { apiKey: string | undefined; now?: () => Date; request?: Fetcher; baseUrl?: string }) {
  const now = options.now ?? (() => new Date());
  const request = options.request ?? fetch;
  const base = options.baseUrl ?? 'https://api.twelvedata.com';
  const memory = new Map<string, Close | null>();
  async function one(symbol: string, date: string): Promise<Close | null> {
    const key = `${symbol}:${date}`;
    if (memory.has(key)) return memory.get(key) ?? null;
    let result: Close | null = null;
    try {
      if (!options.apiKey || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('unavailable');
      const url = new URL(`${base}/time_series`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('interval', '1day');
      url.searchParams.set('outputsize', '5');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('apikey', options.apiKey);
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await request(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (response.status !== 429 || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
      if (!response || response.status !== 200) throw new Error('unavailable');
      const body = (await response.json()) as { status?: unknown; meta?: { symbol?: unknown; currency?: unknown } };
      // 別銘柄・エラー本文・米ドル以外は採用しない。
      if (body?.status === 'error' || (typeof body?.meta?.symbol === 'string' && body.meta.symbol.toUpperCase() !== symbol)) throw new Error('unavailable');
      if (typeof body?.meta?.currency === 'string' && body.meta.currency !== 'USD') throw new Error('unavailable');
      const bar = parseBars(body).find((b) => b.at.slice(0, 10) === date);
      // 提供元が、その日付の日足を返した場合だけ。日付が違う・まだ無い場合は not final として扱う。
      if (bar) result = { symbol, date, close: bar.close, isFinal: true }; // date は確定済みの市場日として選んだもの
    } catch {
      result = null; // 取得失敗は no_close。通知状態は進まず、次の指定時刻に判定し直す。
    }
    memory.set(key, result);
    return result;
  }
  return async function closes(symbols: string[]): Promise<CloseSource> {
    const date = latestSettledSession(now());
    if (!date) return { marketDate: null, closes: [] };
    const out: Close[] = [];
    for (const symbol of [...new Set(symbols)]) {
      const c = await one(symbol, date);
      if (c) out.push(c);
    }
    return { marketDate: date, closes: out };
  };
}
