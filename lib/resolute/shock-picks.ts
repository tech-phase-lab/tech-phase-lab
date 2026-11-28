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
  /** stars null = not judged (owner, Nov 28): the AI ranking failed and the session has no measured numbers, so the owner sets the ★;
   * such a story is never published automatically. */
  suggested: { stars: number | null; reason: { ja: string; en: string }; by: 'ai' | 'rule' };
  /** A must-capture story whose summary was withheld (the reason code): listed for the owner, never pickable or published. */
  withheld?: string;
};
/** A story's RIZEL note as picked (owner, Nov 27: one note, no bullets): up to RIZEL_LINES lines in Japanese, at most RIZEL_MAX_CHARS
 * characters; English when known (an untouched planned note). */
export const RIZEL_LINES = 3, RIZEL_MAX_CHARS = 120;
export type PickLine = { ja: string; en?: string };
export type OwnerPick = { id: string; stars: number; rizel?: PickLine };
/** A note as stored and shown: each line trimmed, empty lines dropped, at most RIZEL_LINES lines kept with their line breaks. */
export const normalizeNote = (text: string) => text.split(/\r?\n/).map(t => t.trim()).filter(Boolean).slice(0, RIZEL_LINES).join('\n');
/** A stored note (a pick, or a planned / published note) as a PickLine; null when it has no Japanese. */
export function pickLine(v: unknown): PickLine | null {
  const x = v as { ja?: unknown; en?: unknown };
  const ja = typeof x?.ja === 'string' ? normalizeNote(x.ja) : '';
  if (!ja) return null;
  const en = typeof x.en === 'string' ? normalizeNote(x.en) : '';
  return en ? { ja, en } : { ja };
}
const HEX64 = /^[a-f0-9]{64}$/, TEXT = /^[^<>\u0000]{1,200}$/;
const isStars = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
export function parseCandidate(v: unknown): ShockCandidate {
  const x = v as ShockCandidate;
  if (!x || typeof x !== 'object' || !HEX64.test(x.id) || !Number.isFinite(Date.parse(x.publishedAt)) || !['market', 'company'].includes(x.group) || !Number.isInteger(x.rank) || x.rank < 1 || x.rank > 50) throw Error('INVALID_CANDIDATE');
  const u = new URL(x.url); if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 2048) throw Error('INVALID_CANDIDATE');
  const s = x.source, g = x.suggested;
  if (!s || typeof s.title !== 'string' || !TEXT.test(s.title) || !Array.isArray(s.tickers) || s.tickers.length > 30 || !s.tickers.every(t => typeof t === 'string' && /^[A-Z][A-Z0-9.]{0,9}$/.test(t)) || !(s.publisher === null || typeof s.publisher === 'string' && TEXT.test(s.publisher))) throw Error('INVALID_CANDIDATE');
  if (!g || !(g.stars === null || isStars(g.stars)) || !['ai', 'rule'].includes(g.by) || !g.reason || typeof g.reason.ja !== 'string' || typeof g.reason.en !== 'string' || !TEXT.test(g.reason.ja) || !TEXT.test(g.reason.en)) throw Error('INVALID_CANDIDATE');
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
    const rawLines = typeof x.rizel?.ja === 'string' ? x.rizel.ja.split(/\r?\n/).filter(t => t.trim()).length : 0;
    if (line && (rawLines > RIZEL_LINES || [...line.ja.replace(/\n/g, '')].length > RIZEL_MAX_CHARS || [...(line.en ?? '')].length > 400 || /[<>\u0000]/.test(line.ja + (line.en ?? '')))) throw Error('INVALID_PICKS');
    return line ? { id: x.id, stars: x.stars, rizel: line } : { id: x.id, stars: x.stars };
  });
}
/** The service's own picks when the owner did not answer (never a story whose ★ is not judged): autoStories in rank order, at least autoMinMarket market-wide when
 * there are that many, the rest by rank (market-wide first within the same rank), each with the suggested ★. */
export function autoPicks(candidates: readonly ShockCandidate[]): OwnerPick[] {
  const { autoStories, autoMinMarket } = RISK_POLICY.ownerPicks;
  const ranked = candidates.filter((c): c is ShockCandidate & { suggested: { stars: number } } => !c.withheld && c.suggested.stars !== null).sort((a, b) => a.rank - b.rank || (a.group === 'market' ? 0 : 1) - (b.group === 'market' ? 0 : 1));
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
/** Why a story has no numbers (owner, Nov 28: 「まだありません（取引がまだ終わっていないか、休場です）」 was shown for every story
 * although Friday's session had closed). Null when it has numbers. */
export const NO_NUMBERS = {
  notClosed: { ja: 'まだありません（このニュースのあとの米国市場の取引が、まだ終わっていません）', en: 'None yet (the U.S. session after this news has not closed yet).' },
  notMeasured: { ja: 'ありません（値動きのデータを取得できませんでした）', en: 'None (the session\'s moves could not be read).' },
  unlisted: { ja: 'ありません（この銘柄の値動きは測っていません）', en: 'None (this stock\'s move is not measured).' },
} as const;
/** A story whose ★ is not judged (owner, Nov 28): shown as it is in the mail and on the owner page. */
export const UNJUDGED = { ja: '★は未判定。オーナーが決めてください', en: 'Stars not judged: the owner decides.' } as const;
export function numbersNote(c: { market: RiskMarket }, locale: 'ja' | 'en' = 'ja'): string | null {
  if (readingParts(c.market, locale).length) return null;
  const m = c.market;
  if (m.index === 'company' && !m.company) return NO_NUMBERS.unlisted[locale];
  return (m.session ? NO_NUMBERS.notMeasured : NO_NUMBERS.notClosed)[locale];
}
/** The AI's RIZEL note is at most this many characters (owner, Nov 28; the owner's own note may use RIZEL_MAX_CHARS). */
export const RIZEL_AI_MAX_CHARS = 100;
/** Stock phrases that came out for nearly every story (owner, Nov 28): 「まず自分のルールを確認」「見出しに流されず」「判断は手順で」… */
export const RIZEL_CLICHES = /(?:まず|先に)?自分の(?:ルール|基準|手順|ルールと[^。]{0,12})を(?:確認|確かめ|見直)|見出し(?:だけ)?に(?:流され|振り回され|飛びつ)|判断は手順|手順で(?:整え|判断)|ニュースは材料|見出しより先に|本文と自分のルール|様子見|\bcheck (?:your|one's) (?:own )?rules\b|\bdon[’']t (?:chase|follow) the headline/i;
/** A price call (owner, Nov 28: no 「上がる」「下がる」 stated as a prediction). */
const PRICE_CALL = /(?:株価|株|相場|指数|価格)[^。]{0,8}(?:上が|下が|上昇す|下落す|反発す|戻)(?:る|ります)(?:はず|だろう|でしょう|と思う|。|$)|\b(?:will|is going to|should) (?:rise|fall|rally|drop|rebound|go (?:up|down))\b/i;
const GENERIC_TERMS = new Set(['ニュース', '記事', '発表', '報道', '見出し', '速報', '市場', '株価', '株式', '相場', '指数', '投資', '投資家', '米国', '日本', '米株', '米国株', '下落', '上昇', '急落', '急騰', '懸念', '企業', '会社', '影響', '取引', '終値', '自分', '判断', '手順', '基準', '材料', '今日', '本日', '今回', '動き', '値動き', '一言', '発言', '関連']);
/** The concrete words of a story a note can name (owner, Nov 28: a company, a product, a country, an event): katakana words, kanji
 * words of two or more characters and Latin names (GB300, NVIDIA) from the headline and the summary, without generic market words. */
export function storyTerms(...texts: string[]): string[] {
  const t = texts.filter(x => typeof x === 'string').join(' ').normalize('NFKC');
  return [...new Set(t.match(/[\p{Script=Katakana}ー]{2,}|\p{Script=Han}{2,}|[A-Za-z][A-Za-z0-9&.-]*[A-Za-z0-9]/gu) ?? [])].filter(w => !GENERIC_TERMS.has(w) && !/^(?:The|A|An|And|Of|In|On|To|For|By|At|As|It|Is|Was|Will|Says?|Said|U\.S|US)$/i.test(w));
}
/** The story an AI note is about: its Japanese headline and summary, the English headline, and the notes already used today. */
export type RizelStory = { title: string; summary?: string; titleEn?: string; avoid?: readonly string[] };
/** Fixed codes for an AI-written RIZEL line that breaks the rules: the RIZEL wording rules (quoteIssues), the summary wording rules
 * (summaryIssues), numbers and length. With the story (owner, Nov 28): at most RIZEL_AI_MAX_CHARS characters, it must name at least
 * one concrete word of the story (storyTerms; 'generic'), no stock phrase ('cliche'), no price call ('price-call'), not a note already
 * used today ('repeat'), and numbers only as the story itself gives them. Without the story every number is refused. The owner's own
 * line is never checked (owner, Nov 27). */
export function rizelIssues(line: { ja?: unknown; en?: unknown } | null | undefined, story?: RizelStory): string[] {
  const ja = typeof line?.ja === 'string' ? normalizeNote(line.ja) : '', en = typeof line?.en === 'string' ? normalizeNote(line.en) : '';
  // One note of 1–3 short sentences (owner, Nov 27), in at most three lines.
  const max = story ? RIZEL_AI_MAX_CHARS : RIZEL_MAX_CHARS;
  if (!ja || !en || [...ja.replace(/\n/g, '')].length > max || en.length > 200 || /[<>\u0000]/.test(ja + en)) return ['shape'];
  const codes = [...quoteIssues({ ja: { title: ja, reasons: [] }, en: { title: en, reasons: [] } }), ...summaryIssues(ja, en)];
  if (!story) { if (/[0-9０-９]/.test(ja + en)) codes.push('number'); return [...new Set(codes)]; }
  const source = [story.title, story.summary ?? '', story.titleEn ?? ''].join(' ').normalize('NFKC');
  if (((ja + ' ' + en).normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) ?? []).some(n => !source.includes(n))) codes.push('number');
  const terms = storyTerms(story.title, story.summary ?? '', story.titleEn ?? '');
  if (!terms.some(w => ja.normalize('NFKC').includes(w))) codes.push('generic');
  if (RIZEL_CLICHES.test(ja) || RIZEL_CLICHES.test(en)) codes.push('cliche');
  if (PRICE_CALL.test(ja) || PRICE_CALL.test(en)) codes.push('price-call');
  if ((story.avoid ?? []).some(a => normalizeNote(a) === ja)) codes.push('repeat');
  return [...new Set(codes)];
}
/** The `edit` query of the owner page (one story from the morning mail), or null when it is not a story id. */
export const editTarget = (v: unknown): string | null => typeof v === 'string' && (HEX64.test(v) || ADDED_ID.test(v)) ? v : null;
/** The RIZEL note the owner typed (up to three lines, kept). Empty means none (the AI writes it). A note identical to `previous` keeps
 * previous's English. */
export function typedLine(text: string, previous?: PickLine | null): PickLine | undefined {
  const ja = normalizeNote(text);
  if (!ja) return undefined;
  return previous && previous.ja === ja ? previous : { ja };
}
/** One story edited from the morning mail (owner, Nov 27): the full pick set the page saves, with only that story's ★ and RIZEL note
 * changed. The set is the owner's answer when there is one, else the service's planned 3 (their notes kept as they are). Null when the
 * story is not in the set. An empty note drops the owner's note (the AI writes one at publish time). */
export function editedPicks(day: { picks: OwnerPick[] | null; planned: { id: string; stars: number; rizel?: unknown }[] }, id: string, stars: number, text: string): OwnerPick[] | null {
  const base: OwnerPick[] = (day.picks ?? day.planned).map(p => { const line = p.rizel ? pickLine(p.rizel) : null; return { id: p.id, stars: p.stars, ...(line ? { rizel: line } : {}) }; });
  if (!isStars(stars) || !base.some(p => p.id === id)) return null;
  return base.map(p => {
    if (p.id !== id) return p;
    const keep = typedLine(text, p.rizel);
    return keep ? { id, stars, rizel: keep } : { id, stars };
  });
}
/** True when `id` (the mail's 「このニュースを直す」) is a story of the day's plan (the owner's answer, else the planned 3) that the page can
 * show on its own; otherwise the full owner page opens (owner, Nov 27). */
export function editableStory(day: { picks: { id: string }[] | null; planned: { id: string }[]; candidates: { id: string }[]; added: { id: string }[] } | null | undefined, id: string): boolean {
  return !!day && (day.picks ?? day.planned).some(p => p.id === id) && (day.candidates.some(c => c.id === id) || day.added.some(a => a.id === id));
}
