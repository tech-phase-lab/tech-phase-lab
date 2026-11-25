import { usMarketSession } from '../research/us-market-session.ts';
import { measureDay, fearChangeOf, readingStars, causeStars, type RiskArticle, type RiskIndex, type RiskMarket } from './risk.ts';
import { storyScope, scopeIndex } from './risk-scope.ts';
/** Shock Gauge stars from actual market moves (server/worker only; no browser import).
 * 1. Pick ONE related TP index per story. 2. Find the first U.S. close after the news.
 * 3. Read that index's close-to-close move from the thermometer snapshot of that session.
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
/** Exact timestamps use their own time; a date-only source date uses the latest instant it could mean (after-the-news guarantee). */
export function newsInstant(publishedAt: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? new Date(Date.parse(publishedAt + 'T00:00:00Z') + 36 * 3600000) : new Date(publishedAt);
}
export function waitingMarket(index: RiskIndex | 'company', publishedAt: string): RiskMarket {
  if (index === 'company') return { index, session: null, reading: null };
  return { index, session: firstCloseAfter(newsInstant(publishedAt)), reading: null };
}
/** One basket's close as the thermometer measured it: the move, its typical move and the constituents up / down. */
export type SessionMove = { previousDate: string; changePercent: number; typicalPercent: number; up: number; down: number; total: number };
export type SessionEntry = Partial<Record<RiskIndex, SessionMove | null>> & { fear?: { level: number; previousLevel: number } | null };
export type SessionMoves = Record<string, SessionEntry | undefined>;
/** Measures BOTH indices on the story's first close once the thermometer has them (owner, Nov 25: the stars are the stronger of
 * the two); otherwise the story keeps waiting. Already-measured stories are unchanged. */
export function applyMarketReaction(article: RiskArticle, moves: SessionMoves): RiskArticle {
  if (article.market.reading !== null || article.market.index === 'company') return article;
  const index = article.market.index;
  const session = article.market.session ?? firstCloseAfter(newsInstant(article.publishedAt));
  const entry = session ? moves[session] : undefined;
  const nas100 = entry?.nas100 && validMove(entry.nas100) ? entry.nas100 : null, sox = entry?.sox && validMove(entry.sox) ? entry.sox : null;
  const from = nas100?.previousDate ?? sox?.previousDate;
  if (!session || !from || (nas100 && sox && nas100.previousDate !== sox.previousDate)) return { ...article, market: { index, session, reading: null } };
  const reading = { from, nas100: nas100 ? measureDay(nas100) : null, sox: sox ? measureDay(sox) : null, fearChange: fearChangeOf(entry?.fear ?? null) };
  return { ...article, market: { index, session, reading }, stars: causeStars(readingStars(reading), article.cause) };
}
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 500;
function validMove(m: Partial<SessionMove>): m is SessionMove {
  return typeof m.previousDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.previousDate) && finite(m.changePercent, -99.99, 99.99) && finite(m.typicalPercent, 0.01, 50) && count(m.up) && count(m.down) && count(m.total) && m.total >= 10 && m.up + m.down <= m.total;
}
export interface MovesDatabase { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
/** Reads the measured shock of the given sessions from the thermometer snapshots (read-only role). Each snapshot carries the
 * last sessions up to its own (snapshot.shock, keyed by session); the earliest snapshot that has a session is used. Only a
 * reading dated on its own session counts. Snapshots stored before Nov 25 have no shock map: those sessions keep waiting. */
export async function readSessionMoves(db: MovesDatabase, sessions: readonly string[]): Promise<SessionMoves> {
  const wanted = [...new Set(sessions.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort();
  if (!wanted.length) return {};
  const { rows } = await db.query("SELECT session_date::text AS session, snapshot->'shock' AS shock FROM resolute_thermometer_snapshots WHERE session_date >= $1::date AND snapshot ? 'shock' ORDER BY session_date LIMIT 30", [wanted[0]]);
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
      out[session] = entry;
    }
  }
  return out;
}
