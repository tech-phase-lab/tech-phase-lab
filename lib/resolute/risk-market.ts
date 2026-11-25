import { usMarketSession } from '../research/us-market-session.ts';
import { measureDay, fearChangeOf, marketStars, causeStars, roundMove, type RiskArticle, type RiskIndex, type RiskMarket, type RiskStock } from './risk.ts';
import { storyScope, scopeIndex, storyTicker } from './risk-scope.ts';
import { industryOf } from './risk-companies.ts';
/** Shock Gauge stars from actual market moves (server/worker only; no browser import).
 * 1. Pick ONE related TP index per story (single-company news: its company and industry basket).
 * 2. Find the session whose move comes AFTER the news (storySession).
 * 3. Read that session's close-to-close moves from the thermometer snapshots.
 */
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
export function cleanTickers(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((t): t is string => typeof t === 'string' && TICKER.test(t)))].slice(0, 30) : [];
}
/** Nov 25 (owner): the index follows the story's scope (risk-scope.ts): market-wide → TP大型株100, the chip sector → TP半導体40,
 * one company → no index (no stars). Tickers no longer decide it: a story about one chip company is still one company's news. */
export function storyIndex(title: string): RiskIndex | 'company' { return scopeIndex(storyScope(title)); }
const STEP = 15 * 60000;
const etDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
/** ET date of the first regular-session close strictly after `at` (a story at exactly 16:00 belongs to the next close).
 * Closes fall on quarter hours (16:00, or 13:00 on early-close days). Null outside the holiday calendar: never guessed. */
export function firstCloseAfter(at: Date): string | null {
  if (!Number.isFinite(at.getTime())) return null;
  let t = Math.floor(at.getTime() / STEP) * STEP + STEP;
  for (let i = 0; i < 4 * 24 * 12; i++, t += STEP) {
    const now = usMarketSession(new Date(t));
    if (now === null) return null;
    if (now === 'post' && usMarketSession(new Date(t - STEP)) === 'regular') return etDate(new Date(t));
  }
  return null;
}
/** The session whose move is credited to a story (owner, Nov 25): only the move AFTER publication counts.
 * Published before the U.S. regular open (pre-market, overnight, a weekend or a holiday): that session, close-to-close.
 * Published during regular hours (exactly 09:30 included) or after them: the NEXT full session, so the move that had already
 * happened before the news is never credited to it (Nov 23: a Monday-afternoon story was given Monday's whole rally, measured
 * from Friday's close). Intraday prices from publication to the close are not read: the thermometer keeps daily closes only.
 * Returns the ET date of the first regular-session open strictly after `at`; null outside the holiday calendar. */
export function storySession(at: Date): string | null {
  if (!Number.isFinite(at.getTime())) return null;
  let t = Math.floor(at.getTime() / STEP) * STEP + STEP;
  for (let i = 0; i < 4 * 24 * 12; i++, t += STEP) {
    const now = usMarketSession(new Date(t));
    if (now === null) return null;
    if (now === 'regular' && usMarketSession(new Date(t - STEP)) !== 'regular') return etDate(new Date(t));
  }
  return null;
}
/** Exact timestamps use their own time; a date-only source date uses the latest instant it could mean (after-the-news guarantee). */
export function newsInstant(publishedAt: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? new Date(Date.parse(publishedAt + 'T00:00:00Z') + 36 * 3600000) : new Date(publishedAt);
}
/** A story before its session is measured. Single-company news is measured only with a rostered `ticker` (risk-companies.ts);
 * without one (or when it lost its session to a story that explains the move better) it is plain company news, never starred. */
export function waitingMarket(index: RiskIndex | 'company', publishedAt: string, ticker: string | null = null): RiskMarket {
  const session = storySession(newsInstant(publishedAt));
  if (index === 'company') {
    const basket = ticker ? industryOf(ticker) : null;
    return ticker && basket ? { index, session, reading: null, company: { ticker, basket } } : { index, session: null, reading: null };
  }
  return { index, session, reading: null };
}
/** The waiting market of an intake candidate: its scope from the headline and, for single-company news, its rostered ticker.
 * `starred: false` (set by the daily selection) marks company news whose session another story explains better. */
export function candidateMarket(c: { title: string; tickers?: readonly string[]; publishedAt: string; starred?: boolean }): RiskMarket {
  const index = storyIndex(c.title);
  return waitingMarket(index, c.publishedAt, index === 'company' && c.starred !== false ? storyTicker(c) : null);
}
/** One basket's close as the thermometer measured it: the move, its typical move and the constituents up / down. */
export type SessionMove = { previousDate: string; changePercent: number; typicalPercent: number; up: number; down: number; total: number };
/** One stock's close-to-close move on a session and its usual move (single-company news). */
export type StockMove = { previousDate: string; changePercent: number; typicalPercent: number };
export type SessionEntry = Partial<Record<RiskIndex, SessionMove | null>> & { fear?: { level: number; previousLevel: number } | null; stocks?: Record<string, StockMove> };
export type SessionMoves = Record<string, SessionEntry | undefined>;
const tenth = (n: number) => Math.round(n * 10) / 10;
/** One stock on the session: its move (0.1) and how many times its usual move (0.1), the same rounding as an index. */
export function measureStock(m: StockMove): RiskStock { return { changePercent: roundMove(m.changePercent), multiple: tenth(Math.abs(m.changePercent) / m.typicalPercent) }; }
/** Measures BOTH indices on the story's session once the thermometer has them (owner, Nov 25: the stars are the stronger of
 * the two); otherwise the story keeps waiting. Single-company news also reads its own stock on that session (null when the
 * stock was not priced: it then stays unstarred company news). Already-measured stories and unmeasurable company news are
 * unchanged. */
export function applyMarketReaction(article: RiskArticle, moves: SessionMoves): RiskArticle {
  const m = article.market;
  if (m.reading !== null || (m.index === 'company' && !m.company)) return article;
  const { index, company } = m;
  const session = m.session ?? storySession(newsInstant(article.publishedAt));
  const entry = session ? moves[session] : undefined;
  const nas100 = entry?.nas100 && validMove(entry.nas100) ? entry.nas100 : null, sox = entry?.sox && validMove(entry.sox) ? entry.sox : null;
  const from = nas100?.previousDate ?? sox?.previousDate;
  const keep = company ? { company } : {};
  if (!session || !from || (nas100 && sox && nas100.previousDate !== sox.previousDate)) return { ...article, market: { index, session, reading: null, ...keep } };
  const reading: NonNullable<RiskMarket['reading']> = { from, nas100: nas100 ? measureDay(nas100) : null, sox: sox ? measureDay(sox) : null, fearChange: fearChangeOf(entry?.fear ?? null) };
  if (company) { const s = entry?.stocks?.[company.ticker]; reading.company = s && validStock(s) && s.previousDate === from ? measureStock(s) : null; }
  const market: RiskMarket = { index, session, reading, ...keep };
  return { ...article, market, stars: causeStars(marketStars(market), article.cause) };
}
function validStock(m: Partial<StockMove>): m is StockMove {
  return typeof m.previousDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.previousDate) && finite(m.changePercent, -99.99, 99.99) && finite(m.typicalPercent, 0.01, 50);
}
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 500;
function validMove(m: Partial<SessionMove>): m is SessionMove {
  return typeof m.previousDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.previousDate) && finite(m.changePercent, -99.99, 99.99) && finite(m.typicalPercent, 0.01, 50) && count(m.up) && count(m.down) && count(m.total) && m.total >= 10 && m.up + m.down <= m.total;
}
export interface MovesDatabase { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
/** Reads the measured shock of the given sessions from the thermometer snapshots (read-only role). Each snapshot carries the
 * last sessions up to its own (snapshot.shock, keyed by session); the earliest snapshot that has a session is used. Only a
 * reading dated on its own session counts. Snapshots stored before Nov 25 have no shock map: those sessions keep waiting.
 * The rostered stocks' own moves (snapshot.shockStocks, stored only, never served to the site) come with the same snapshot. */
export async function readSessionMoves(db: MovesDatabase, sessions: readonly string[]): Promise<SessionMoves> {
  const wanted = [...new Set(sessions.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort();
  if (!wanted.length) return {};
  const { rows } = await db.query("SELECT session_date::text AS session, snapshot->'shock' AS shock, snapshot->'shockStocks' AS stocks FROM resolute_thermometer_snapshots WHERE session_date >= $1::date AND snapshot ? 'shock' ORDER BY session_date LIMIT 30", [wanted[0]]);
  const out: SessionMoves = {};
  for (const row of rows) {
    const map = row.shock as Record<string, Record<string, unknown> | null> | null;
    if (!map || typeof map !== 'object') continue;
    for (const session of wanted) {
      const raw = map[session];
      if (out[session] || !raw || typeof raw !== 'object') continue;
      const entry: SessionEntry = {};
      for (const index of ['sox', 'nas100'] as const) {
        const m = raw[index] as (Partial<SessionMove> & { date?: unknown }) | null;
        if (m && m.date === session && validMove(m)) entry[index] = { previousDate: m.previousDate, changePercent: m.changePercent, typicalPercent: m.typicalPercent, up: m.up, down: m.down, total: m.total };
      }
      const f = raw.fear as { date?: unknown; level?: unknown; previousLevel?: unknown } | null;
      entry.fear = f && f.date === session && finite(f.level, 0.01, 1000) && finite(f.previousLevel, 0.01, 1000) ? { level: f.level, previousLevel: f.previousLevel } : null;
      const day = row.stocks && typeof row.stocks === 'object' ? (row.stocks as Record<string, unknown>)[session] : null;
      if (day && typeof day === 'object') {
        const stocks: Record<string, StockMove> = {};
        for (const [ticker, value] of Object.entries(day as Record<string, Partial<StockMove> & { date?: unknown }>)) {
          if (/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker) && value && value.date === session && validStock(value)) stocks[ticker] = { previousDate: value.previousDate, changePercent: value.changePercent, typicalPercent: value.typicalPercent };
        }
        if (Object.keys(stocks).length) entry.stocks = stocks;
      }
      out[session] = entry;
    }
  }
  return out;
}
