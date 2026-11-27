import { RISK_POLICY } from './risk-policy.ts';
import { parseRiskCopy, parseRiskMarket, readingParts, type RiskCopy, type RiskMarket } from './risk.ts';
import { calendarEvents } from '../research/calendar.ts';
import { quoteIssues, summaryIssues } from './risk-copy-check.ts';
/** The Shock Gauge owner pick (owner, Nov 27). Pure, browser-safe: shared by the worker, the owner API and the owner page.
 * A candidate is one story of the day, ranked by how much the news shakes the market (market-wide) or the stock (single-company),
 * with its summary, its measured numbers when there are any, and a suggested ★ with a one-line reason. */
export type CandidateGroup = 'market' | 'company';
export type ShockCandidate = {
  id: string; url: string; publishedAt: string; group: CandidateGroup; rank: number;
  /** The source headline and tickers (to measure the story again at the publish run). */
  source: { title: string; tickers: string[]; publisher: string | null };
  ja: RiskCopy; en: RiskCopy; market: RiskMarket;
  suggested: { stars: number; reason: { ja: string; en: string }; by: 'ai' | 'rule' };
  /** A must-capture story whose summary was withheld (the reason code): listed for the owner, never pickable or published. */
  withheld?: string;
};
/** One picked story: its ★ and, optionally, the owner's own RIZEL line (published exactly as written, no wording check; English optional). */
/** A story's RIZEL line as picked: the title line and up to three bullet lines (Japanese; English when known). */
export type PickLine = { ja: string; en?: string; reasons?: string[]; enReasons?: string[] };
export type OwnerPick = { id: string; stars: number; rizel?: PickLine };
/** A stored line in either shape (a pick's PickLine, or a planned / published line with reasons: {ja, en}) as a PickLine. */
export function pickLine(v: unknown): PickLine | null {
  const x = v as { ja?: unknown; en?: unknown; reasons?: unknown; enReasons?: unknown };
  const ja = typeof x?.ja === 'string' ? x.ja.trim() : '';
  if (!ja) return null;
  const list = (r: unknown) => Array.isArray(r) ? r.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean).slice(0, 3) : [];
  const r = x.reasons, reasons = Array.isArray(r) ? list(r) : r && typeof r === 'object' ? list((r as { ja?: unknown }).ja) : [];
  const enReasons = Array.isArray(r) ? list(x.enReasons) : r && typeof r === 'object' ? list((r as { en?: unknown }).en) : [];
  const en = typeof x.en === 'string' && x.en.trim() ? x.en.trim() : undefined;
  return { ja, ...(en ? { en } : {}), ...(reasons.length ? { reasons } : {}), ...(reasons.length && enReasons.length === reasons.length ? { enReasons } : {}) };
}
const HEX64 = /^[a-f0-9]{64}$/, TEXT = /^[^<>\u0000]{1,200}$/;
const isStars = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
export function parseCandidate(v: unknown): ShockCandidate {
  const x = v as ShockCandidate;
  if (!x || typeof x !== 'object' || !HEX64.test(x.id) || !Number.isFinite(Date.parse(x.publishedAt)) || !['market', 'company'].includes(x.group) || !Number.isInteger(x.rank) || x.rank < 1 || x.rank > 50) throw Error('INVALID_CANDIDATE');
  const u = new URL(x.url); if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 2048) throw Error('INVALID_CANDIDATE');
  const s = x.source, g = x.suggested;
  if (!s || typeof s.title !== 'string' || !TEXT.test(s.title) || !Array.isArray(s.tickers) || s.tickers.length > 30 || !s.tickers.every(t => typeof t === 'string' && /^[A-Z][A-Z0-9.]{0,9}$/.test(t)) || !(s.publisher === null || typeof s.publisher === 'string' && TEXT.test(s.publisher))) throw Error('INVALID_CANDIDATE');
  if (!g || !isStars(g.stars) || !['ai', 'rule'].includes(g.by) || !g.reason || typeof g.reason.ja !== 'string' || typeof g.reason.en !== 'string' || !TEXT.test(g.reason.ja) || !TEXT.test(g.reason.en)) throw Error('INVALID_CANDIDATE');
  return { id: x.id, url: u.href, publishedAt: x.publishedAt, group: x.group, rank: x.rank, source: { title: s.title, tickers: [...s.tickers], publisher: s.publisher },
    ja: parseRiskCopy(x.ja), en: parseRiskCopy(x.en), market: parseRiskMarket(x.market), suggested: { stars: g.stars, reason: { ja: g.reason.ja, en: g.reason.en }, by: g.by },
    ...(typeof x.withheld === 'string' && /^[a-z-]{1,30}$/.test(x.withheld) ? { withheld: x.withheld } : {}) };
}
/** A story the owner added (owner, Nov 27: sometimes none of the candidates can be published): drafted from the owner's screenshots
 * and / or pasted text (the owner may edit the draft), with the owner's ★. `url` is the source link when the owner gave one. */
export type AddedStory = { id: string; url: string | null; publisher: string | null; ja: { title: string; summary: string }; en: { title: string; summary: string }; stars: number; addedAt: string };
const ADDED_ID = /^o[a-f0-9]{20}$/, SUMMARY = /^[^<>\u0000]{1,400}$/;
export function parseAdded(v: unknown): AddedStory {
  const x = v as AddedStory;
  if (!x || typeof x !== 'object' || !ADDED_ID.test(x.id) || !isStars(x.stars) || !Number.isFinite(Date.parse(x.addedAt))) throw Error('INVALID_ADDED');
  let url: string | null = null;
  if (x.url !== null && x.url !== undefined) { const u = new URL(x.url); if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 2048) throw Error('INVALID_ADDED'); url = u.href; }
  if (!(x.publisher === null || x.publisher === undefined || typeof x.publisher === 'string' && TEXT.test(x.publisher))) throw Error('INVALID_ADDED');
  for (const l of ['ja', 'en'] as const) { const c = x[l]; if (!c || typeof c.title !== 'string' || !TEXT.test(c.title.trim()) || typeof c.summary !== 'string' || !SUMMARY.test(c.summary.trim())) throw Error('INVALID_ADDED'); }
  return { id: x.id, url, publisher: x.publisher?.trim() || null, ja: { title: x.ja.title.trim(), summary: x.ja.summary.trim() }, en: { title: x.en.title.trim(), summary: x.en.summary.trim() }, stars: x.stars, addedAt: new Date(x.addedAt).toISOString() };
}
/** The owner's answer: 1 to maxStories distinct stories of the day (candidates or the owner's own added stories), each with ★1–5,
 * in the owner's order. Throws otherwise. */
export function parsePicks(v: unknown, candidates: readonly { id: string; withheld?: string }[]): OwnerPick[] {
  if (!Array.isArray(v) || !v.length || v.length > RISK_POLICY.ownerPicks.maxStories) throw Error('INVALID_PICKS');
  const ids = new Set(candidates.filter(c => !c.withheld).map(c => c.id)), seen = new Set<string>();
  return v.map(p => {
    const x = p as OwnerPick;
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !ids.has(x.id) || seen.has(x.id) || !isStars(x.stars)) throw Error('INVALID_PICKS');
    seen.add(x.id);
    if (x.rizel !== undefined && x.rizel !== null && typeof x.rizel !== 'object') throw Error('INVALID_PICKS');
    const line = x.rizel ? pickLine(x.rizel) : null;
    if (line && ([...line.ja].length > 80 || [...(line.en ?? '')].length > 200 || (Array.isArray(x.rizel?.reasons) && x.rizel.reasons.length > 3) || [...(line.reasons ?? []), ...(line.enReasons ?? [])].some(t => [...t].length > 120))) throw Error('INVALID_PICKS');
    return line ? { id: x.id, stars: x.stars, rizel: line } : { id: x.id, stars: x.stars };
  });
}
/** The service's own picks when the owner did not answer: autoStories in rank order, at least autoMinMarket market-wide when
 * there are that many, the rest by rank (market-wide first within the same rank), each with the suggested ★. */
export function autoPicks(candidates: readonly ShockCandidate[]): OwnerPick[] {
  const { autoStories, autoMinMarket } = RISK_POLICY.ownerPicks;
  const ranked = candidates.filter(c => !c.withheld).sort((a, b) => a.rank - b.rank || (a.group === 'market' ? 0 : 1) - (b.group === 'market' ? 0 : 1));
  const market = ranked.filter(c => c.group === 'market').slice(0, autoMinMarket), taken = new Set(market.map(c => c.id));
  const rest = ranked.filter(c => !taken.has(c.id)).slice(0, Math.max(0, autoStories - market.length));
  const chosen = new Set([...market, ...rest].map(c => c.id));
  return ranked.filter(c => chosen.has(c.id)).map(c => ({ id: c.id, stars: c.suggested.stars }));
}
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+09:00`);
const etDate = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const etHour = (t: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
/** The watched companies that report after the U.S. close on the New York day that ends just before the JST day `day`'s morning
 * (the research calendar, lib/research/calendar.ts: afterClose, or a time at or after 16:00 New York). */
export function earningsAfterClose(day: string, events: readonly { kind: string; startsAt: string; afterClose?: boolean; ticker?: string }[] = calendarEvents): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const usDay = etDate(at(day, '06:00'));
  return [...new Set(events.filter(e => e.kind === 'earnings' && Number.isFinite(Date.parse(e.startsAt)) && etDate(Date.parse(e.startsAt)) === usDay && (e.afterClose === true || etHour(Date.parse(e.startsAt)) >= 16)).map(e => e.ticker ?? ''))].filter(Boolean);
}
/** When the day's candidates are built (JST HH:MM): candidateRunEarningsJst on an after-close earnings day, else candidateRunJst. */
export function candidateRunTime(day: string, events?: Parameters<typeof earningsAfterClose>[1]): string {
  const { candidateRunJst, candidateRunEarningsJst } = RISK_POLICY.ownerPicks;
  return earningsAfterClose(day, events).length ? candidateRunEarningsJst : candidateRunJst;
}
/** True when a candidate run at `now` should build the day's candidates (the cron starts at both times; the earlier one waits on an
 * earnings day, and the run must start before the answer deadline). */
export function isCandidateRun(now: Date, events?: Parameters<typeof earningsAfterClose>[1]): boolean {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10), t = now.getTime();
  return t >= at(day, candidateRunTime(day, events)) && t < at(day, RISK_POLICY.ownerPicks.answerUntilJst);
}
/** True while the owner's answer for `day` (JST) is accepted: from the earliest candidate run until answerUntilJst. */
export function answerOpen(day: string, now: Date): boolean {
  const { candidateRunJst, answerUntilJst } = RISK_POLICY.ownerPicks, t = now.getTime();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && t >= at(day, candidateRunJst) && t < at(day, answerUntilJst);
}
/** The JST day whose candidates the owner is answering now, or null outside the answer window. */
export function answerDay(now: Date): string | null {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return answerOpen(day, now) ? day : null;
}
/** The measured numbers as text lines (the card's table), none when the story's session has no measured move. */
export const candidateNumbers = (c: { market: RiskMarket }, locale: 'ja' | 'en') => readingParts(c.market, locale).map(l => l.text);
/** Fixed codes for an AI-written RIZEL line that breaks the rules: the RIZEL wording rules (quoteIssues), the summary wording rules
 * (summaryIssues), numbers and length. The owner's own line is never checked (owner, Nov 27). */
export function rizelIssues(line: { ja?: unknown; en?: unknown; reasons?: { ja?: unknown; en?: unknown } } | null | undefined): string[] {
  const ja = typeof line?.ja === 'string' ? line.ja.trim() : '', en = typeof line?.en === 'string' ? line.en.trim() : '';
  const rj = Array.isArray(line?.reasons?.ja) ? (line!.reasons!.ja as unknown[]) : [], re = Array.isArray(line?.reasons?.en) ? (line!.reasons!.en as unknown[]) : [];
  // The title and three bullet lines (owner, Nov 27: the same shape as an approved quote).
  if (!ja || !en || [...ja].length > 50 || en.split(/\s+/).length > 20 || rj.length !== 3 || re.length !== 3) return ['shape'];
  if (![...rj, ...re].every(t => typeof t === 'string' && t.trim())) return ['shape'];
  const bj = (rj as string[]).map(t => t.trim()), be = (re as string[]).map(t => t.trim());
  if (bj.some(t => [...t].length > 60) || be.some(t => t.split(/\s+/).length > 24) || /[<>\u0000\n]/.test([ja, en, ...bj, ...be].join(''))) return ['shape'];
  const codes = [...quoteIssues({ ja: { title: ja, reasons: bj }, en: { title: en, reasons: be } }), ...summaryIssues(ja, en, ...bj, ...be)];
  if (/[0-9０-９]/.test([ja, en, ...bj, ...be].join(''))) codes.push('number');
  return [...new Set(codes)];
}
/** The `edit` query of the owner page (one story from the morning mail), or null when it is not a story id. */
export const editTarget = (v: unknown): string | null => typeof v === 'string' && (HEX64.test(v) || ADDED_ID.test(v)) ? v : null;
/** The RIZEL line the owner typed (title + up to three bullets) as a pick line. An empty title means none (the AI writes the whole
 * line); empty bullets are left out. A line identical to `previous` keeps previous's English. */
export function typedLine(title: string, bullets: readonly string[], previous?: PickLine | null): PickLine | undefined {
  const ja = title.trim(), reasons = bullets.map(t => t.trim()).filter(Boolean).slice(0, 3);
  if (!ja) return undefined;
  const prevReasons = previous?.reasons ?? [];
  if (previous && previous.ja === ja && prevReasons.length === reasons.length && prevReasons.every((t, i) => t === reasons[i])) return previous;
  return { ja, ...(reasons.length ? { reasons } : {}) };
}
/** One story edited from the morning mail (owner, Nov 27): the full pick set the page saves, with only that story's ★ and RIZEL line
 * (title and bullets) changed. The set is the owner's answer when there is one, else the service's planned 3 (their lines kept as they
 * are). Null when the story is not in the set. An empty title drops the owner's line (the AI writes one at publish time). */
export function editedPicks(day: { picks: OwnerPick[] | null; planned: { id: string; stars: number; rizel?: unknown }[] }, id: string, stars: number, title: string, bullets: readonly string[] = []): OwnerPick[] | null {
  const base: OwnerPick[] = (day.picks ?? day.planned).map(p => { const line = p.rizel ? pickLine(p.rizel) : null; return { id: p.id, stars: p.stars, ...(line ? { rizel: line } : {}) }; });
  if (!isStars(stars) || !base.some(p => p.id === id)) return null;
  return base.map(p => {
    if (p.id !== id) return p;
    const keep = typedLine(title, bullets, p.rizel);
    return keep ? { id, stars, rizel: keep } : { id, stars };
  });
}
/** True when `id` (the mail's 「このニュースを直す」) is a story of the day's plan (the owner's answer, else the planned 3) that the page can
 * show on its own; otherwise the full owner page opens (owner, Nov 27). */
export function editableStory(day: { picks: { id: string }[] | null; planned: { id: string }[]; candidates: { id: string }[]; added: { id: string }[] } | null | undefined, id: string): boolean {
  return !!day && (day.picks ?? day.planned).some(p => p.id === id) && (day.candidates.some(c => c.id === id) || day.added.some(a => a.id === id));
}
