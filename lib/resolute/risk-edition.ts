import { usMarketSession } from '../research/us-market-session.ts';
import { duringSession, storySession, newsInstant } from './risk-market.ts';
import { RISK_POLICY } from './risk-policy.ts';
/** The news window of a Shock Gauge edition (owner, Nov 27: "that day only"). The gauge is published every day, weekends and U.S.
 * holidays included, so an edition covers the news since the previous edition's publish run. A story in
 * the window is measured on the U.S. session it was published during, or (pre-market, overnight, a weekend) the next one, and only
 * when that session is the latest one that has closed; otherwise it has no measured numbers (a weekend, a holiday, news after the
 * close) and still qualifies. A story is never measured on an earlier session than the latest closed one. Pure, browser-safe. */
export const EDITION_HOURS = 24;
export type Edition = { from: number; to: number; session: string | null };
const etDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const STEP = 15 * 60000;
/** ET date of the latest U.S. regular session that closed at or before `at`; null outside the holiday calendar. */
export function latestClosedSession(at: Date): string | null {
  if (!Number.isFinite(at.getTime())) return null;
  let t = Math.floor(at.getTime() / STEP) * STEP;
  for (let i = 0; i < 4 * 24 * 12; i++, t -= STEP) {
    const now = usMarketSession(new Date(t));
    if (now === null) return null;
    if (now === 'post' && usMarketSession(new Date(t - STEP)) === 'regular') return etDate(new Date(t));
  }
  return null;
}
/** The publish run (ms) of the JST day `now` falls on (RISK_POLICY.ownerPicks.publishRunJst). */
export function publishRunOf(now: Date): number {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return Date.parse(`${day}T${RISK_POLICY.ownerPicks.publishRunJst}:00+09:00`);
}
/** The edition of the JST day `now` falls on: the news since the previous day's publish run (EDITION_HOURS before this day's),
 * up to `now` (the candidate run at 02:00 JST reads what is out so far, the publish run everything up to 08:20 JST), and the
 * session its stories may be measured on. Null on an invalid clock. */
export function editionAt(now: Date): Edition | null {
  if (!Number.isFinite(now.getTime())) return null;
  return { from: publishRunOf(now) - EDITION_HOURS * 3600000, to: now.getTime(), session: latestClosedSession(now) };
}
/** True when a story with an exact timestamp was published inside the edition's window. Date-only dates cannot be placed. */
export function inEdition(publishedAt: string, edition: Edition | null): boolean {
  if (!edition || typeof publishedAt !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return false;
  const t = Date.parse(publishedAt);
  return Number.isFinite(t) && t > edition.from && t <= edition.to;
}
/** The session a story in the edition is measured on: the session it was published during, else the next one, and only when that
 * is the edition's (latest closed) session. Null = no measured numbers for this edition. */
export function editionSession(publishedAt: string, edition: Edition | null): string | null {
  if (!edition?.session) return null;
  const at = newsInstant(publishedAt), s = duringSession(at) ?? storySession(at);
  return s === edition.session ? s : null;
}

// Recaps of a move over several sessions (owner, Nov 27: 「Sandisk株が34%下落」 was Nov 13 → Nov 25, not that day's move).
const RECAP = /\b(?:this|last|past|the) (?:week|month|year|quarter)\b|\b(?:weekly|monthly|yearly|quarterly) (?:gain|loss|drop|decline|fall|rise|rally|slump|move)s?\b|\bfor the (?:week|month|year|quarter)\b|\b(?:year|month|quarter|week)[- ]to[- ]date\b|\bYTD\b|(?<!\b(?:day|session|days|sessions) )\bsince\b|\bfrom (?:its |their |the )?(?:record |all-time |recent |52-week |peak |\d{4} )?(?:highs?|peaks?|tops?|lows?|record)\b|\boff (?:its |their |the )?(?:record |all-time |recent |52-week )?(?:highs?|peaks?)\b|\b(?:in|over) (?:the (?:past|last) )?(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|a few) (?:trading )?(?:days|sessions|weeks|months|years)\b|\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)[- ](?:day|session|week|month)s?\b(?! (?:high|low))|\b(?:straight|consecutive) (?:days?|sessions?|weeks?|months?)\b|\b(?:losing|winning) streak\b|\b(?:best|worst) (?:week|month|year|quarter)\b|今週|先週|今月|先月|今年|年初来|年初から|週間で|カ月で|ヶ月で|か月で|\d+日間|\d+営業日|高値から|以来|連続/i;
const MOVE_WORD = /\b(?:fell|falls?|falling|drops?|dropped|slides?|slid|sinks?|sank|tumbl\w+|plung\w+|slump\w*|declin\w+|loses?|lost|tank\w*|crash\w*|rall\w+|ris(?:e|es|ing)|rose|jump\w*|soar\w*|surg\w+|gain\w*|climb\w*|rebound\w*|down|up|lower|higher|wiped?|shed\w*)\b|下落|急落|上昇|急騰|下げ|上げ|値下がり|値上がり|減|増/i;
/** True for a headline about a move over several sessions ("… this week", "… since …", "… from its high", 「年初来」). */
export function isRecapHeadline(title: string): boolean {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  return RECAP.test(t) && (MOVE_WORD.test(t) || /\d+(?:\.\d+)?\s*%/.test(t));
}
/** The size (absolute %) a headline states for its move ("Sandisk stock drops 34%"), or null when it states none. */
export function headlinePercent(title: string): number | null {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  const m = /([+\-−]?\d+(?:\.\d+)?)\s*(?:%|％|パーセント|percent\b)/i.exec(t);
  return m ? Math.abs(Number(m[1].replace('−', '-'))) : null;
}
/** Owner, Nov 27: a headline % that is not the session's measured move (close or intraday extreme, within PERCENT_TOLERANCE
 * points, absolute values) is another day's move. `measured`: the session's moves in %; empty = cannot be checked. */
export const PERCENT_TOLERANCE = 1;
export function percentMismatch(title: string, measured: readonly (number | null | undefined)[]): boolean {
  const said = headlinePercent(title), known = measured.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (said === null || !known.length) return false;
  return !known.some(x => Math.abs(Math.abs(x) - said) <= PERCENT_TOLERANCE);
}

// A story about an earlier session (owner, Nov 28: 「米国株は水曜日に下落しました」 was planned for Saturday's edition, whose session
// is Friday Nov 27). inEdition places a story by its publication time only, so a look back at Wednesday published after Thanksgiving
// entered the window, and isRecapHeadline only catches multi-day recaps ("this week"). A sentence that names a weekday or a date
// together with a market move or a session word gives the day of the event it reports; when that day is before the edition's
// session (edition.session, the latest closed U.S. session), the story is about an earlier session and is not this edition's news,
// whatever its topic (must-capture topics included). The session's own day, a later day (weekend news after the close), forward-
// looking mentions ("next Wednesday", 「来週水曜」) and stories without a weekday or a date are kept.
const WEEKDAYS_EN = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'];
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SESSION_WORD = /\b(?:session|trading|traded|close[ds]?|closing|ended|finished|settled|opened|stocks?|shares?|index|indexes|indices|Nasdaq|Dow|market|Wall Street)\b|S&P|取引|終値|引け|株価|株式|相場|市場|指数|ナスダック|ダウ|米国株|米株|日経/i;
const FORWARD_EN = /\b(?:next|coming|upcoming|until|through|by|before|ahead of|starting)\s+$/i;
const FORWARD_JA = /(?:来週|次の|次回|翌週)\s*の?\s*$/;
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const shiftDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** The sentences of a text (English and Japanese punctuation, line breaks, the 「 — 」 of a headline). "Nov. 25", "U.S." and "Inc."
 * do not end a sentence. */
const sentences = (text: string) => text.normalize('NFKC').split(/(?<=(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|Mr|Mrs|Ms|Dr|St|Inc|Corp|Co|Ltd|vs|U\.S|U\.K))[.!?])\s+|(?<=[。！？])|\n+|\s+[—–]\s+/).map(s => s.trim()).filter(Boolean);
/** The dates (YYYY-MM-DD) a sentence names as a day: a weekday (the latest such day up to the edition's Tokyo date), a month and day
 * ("Nov. 25", 「11月25日」), or a day of the month alone (「25日の」「25日に」: this month, or last month when it is still ahead). */
function namedDays(sentence: string, edition: Edition): string[] {
  const out: string[] = [], ref = new Date(edition.to + 9 * 3600000).toISOString().slice(0, 10), refDay = new Date(`${ref}T12:00:00Z`).getUTCDay();
  const before = (i: number) => sentence.slice(Math.max(0, i - 24), i);
  const weekday = (w: number) => { out.push(shiftDays(ref, -((refDay - w + 7) % 7))); };
  for (const m of sentence.matchAll(/\b(sun|mon|tues|wednes|thurs|fri|satur)day(?:'s)?\b/gi)) if (!FORWARD_EN.test(before(m.index))) weekday(WEEKDAYS_EN.indexOf(m[1].toLowerCase()));
  for (const m of sentence.matchAll(/([日月火水木金土])曜(?:日)?/g)) if (!FORWARD_JA.test(before(m.index))) weekday(WEEKDAYS_JA.indexOf(m[1]));
  const year = Number(ref.slice(0, 4)), month = Number(ref.slice(5, 7));
  const place = (y: number, m: number, d: number) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    let iso = isoOf(y, m, d);
    if (iso > shiftDays(ref, 40)) iso = isoOf(y - 1, m, d);
    out.push(iso);
  };
  for (const m of sentence.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:%|percent|million|billion|trillion))/gi)) place(year, MONTHS_EN.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  for (const m of sentence.matchAll(/(\d{1,2})月(\d{1,2})日/g)) place(year, Number(m[1]), Number(m[2]));
  for (const m of sentence.matchAll(/(?<![\d月])(\d{1,2})日(?:の|に|は)/g)) {
    const d = Number(m[1]);
    if (d > Number(ref.slice(8, 10))) place(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, d); else place(year, month, d);
  }
  return out;
}
/** True when the text (a headline and lead, or a summary) reports an event of an earlier session than the edition's: a sentence with a
 * session or move word names a day before edition.session (up to a month back), and no such sentence names edition.session or a later
 * day ("Stocks rose Friday after Wednesday's drop" is Friday's news). */
export function earlierSessionMention(text: string, edition: Edition | null): boolean {
  if (!edition?.session || typeof text !== 'string' || !text.trim()) return false;
  const session = edition.session, oldest = shiftDays(session, -31);
  let stale = false, current = false;
  for (const s of sentences(text)) {
    if (!(SESSION_WORD.test(s) || MOVE_WORD.test(s))) continue;
    for (const day of namedDays(s, edition)) { if (day >= session) current = true; else if (day >= oldest) stale = true; }
  }
  return stale && !current;
}
/** The text the intake checks for an earlier session: the headline and the lead (the source body's first three sentences). */
export function storyLead(title: string, body: string): string {
  return [title, ...sentences(typeof body === 'string' ? body : '').slice(0, 3)].join('\n');
}
