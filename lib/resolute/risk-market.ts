import rosters from './thermometer-rosters.json' with { type: 'json' };
import { usMarketSession } from '../research/us-market-session.ts';
import { roundMove, starsFromMove, type RiskArticle, type RiskIndex, type RiskMarket } from './risk.ts';
/** Shock Gauge stars from actual market moves (server/worker only; no browser import).
 * 1. Pick ONE related TP index per story. 2. Find the first U.S. close after the news.
 * 3. Read that index's close-to-close move from the thermometer snapshot of that session.
 */
const SEMIS: ReadonlySet<string> = new Set(rosters.semiconductors.tickers);
// Semiconductor / AI-chip topics, and the largest TP半導体40 constituents by name (general news carries no ticker list).
const SEMI_TOPIC = /\b(?:semiconductors?|chips?|chipmakers?|chip-?making|AI accelerators?|GPUs?|HBM|foundr(?:y|ies)|wafers?|lithography|NVIDIA|TSMC|Taiwan Semiconductor|Broadcom|SK ?hynix|AMD|Advanced Micro Devices|Micron|ASML|Intel|Applied Materials|Lam Research|KLA|Texas Instruments|Qualcomm|Arm Holdings|Marvell|Analog Devices|NXP|GlobalFoundries)\b|半導体|AIチップ|AI向けチップ|エヌビディア|マイクロン|TSMC|台湾積体電路/i;
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
export function cleanTickers(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((t): t is string => typeof t === 'string' && TICKER.test(t)))].slice(0, 30) : [];
}
/** TP半導体40 when a ticker is a constituent or the story is about semiconductors / AI chips; otherwise TP大型株100. */
export function chooseRiskIndex({ tickers = [], texts = [] }: { tickers?: readonly string[]; texts?: readonly string[] }): RiskIndex {
  if (tickers.some(t => SEMIS.has(t))) return 'sox';
  return texts.some(t => typeof t === 'string' && SEMI_TOPIC.test(t)) ? 'sox' : 'nas100';
}
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
export function waitingMarket(index: RiskIndex, publishedAt: string): RiskMarket {
  return { index, session: firstCloseAfter(newsInstant(publishedAt)), changePercent: null };
}
export type SessionMoves = Record<string, Partial<Record<RiskIndex, { changePercent: number } | null>> | undefined>;
/** Fills stars once that close's move is known; otherwise the story keeps waiting. Already-filled stories are unchanged. */
export function applyMarketReaction(article: RiskArticle, moves: SessionMoves): RiskArticle {
  if (article.market.changePercent !== null) return article;
  const session = article.market.session ?? firstCloseAfter(newsInstant(article.publishedAt));
  const move = session ? moves[session]?.[article.market.index] : undefined;
  if (!session || !move || typeof move.changePercent !== 'number' || !Number.isFinite(move.changePercent) || Math.abs(move.changePercent) >= 100) return { ...article, market: { ...article.market, session } };
  const changePercent = roundMove(move.changePercent);
  return { ...article, market: { index: article.market.index, session, changePercent }, stars: starsFromMove(changePercent) };
}
export interface MovesDatabase { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
/** Reads the thermometer snapshots' daily moves for the given sessions (read-only role). Only moves dated on their own session count. */
export async function readSessionMoves(db: MovesDatabase, sessions: readonly string[]): Promise<SessionMoves> {
  const wanted = [...new Set(sessions.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))];
  if (!wanted.length) return {};
  const { rows } = await db.query("SELECT session_date::text AS session, snapshot->'moves' AS moves FROM resolute_thermometer_snapshots WHERE session_date = ANY($1::date[])", [wanted]);
  const out: SessionMoves = {};
  for (const row of rows) {
    const session = String(row.session), moves = row.moves as Record<string, { date?: unknown; changePercent?: unknown } | null> | null;
    if (!moves || typeof moves !== 'object') continue;
    const entry: Partial<Record<RiskIndex, { changePercent: number }>> = {};
    for (const index of ['sox', 'nas100'] as const) {
      const m = moves[index];
      if (m && m.date === session && typeof m.changePercent === 'number' && Number.isFinite(m.changePercent) && Math.abs(m.changePercent) < 100) entry[index] = { changePercent: m.changePercent };
    }
    out[session] = entry;
  }
  return out;
}
