import type { PlanInput } from './plan-data.ts';
import type { NotificationSettings } from './notification-settings.ts';
import type { ThermometerSnapshot } from './thermometer-view.ts';
import type { Copy } from '../research/data.ts';
import { deliveryClock } from './delivery-time.ts';

/** 今夜のひと息 (owner, Nov 25: rebuilt). A place to calm down on a crash or surge night: only what changes from night to night.
 * Never today's loss amount or the share of the member's own assets lost. Pure functions; the page and resolute-api share them. */

export type TonightIndex = 'nas100' | 'sox';
export type TonightDirection = 'down' | 'up';
export const TONIGHT_INDEX_NAME: Record<TonightIndex, Copy> = { nas100: { ja: 'TP大型株100', en: 'TP Large Cap 100' }, sox: { ja: 'TP半導体40', en: 'TP Semiconductor 40' } };

/** Members whose main holdings are single stocks (or a mix) in tech and semiconductors follow TP半導体40; everyone else TP大型株100
 * (the same rule as the estimated drop, resolute-pc-1125 §5). */
export function tonightIndex(plan: Pick<PlanInput, 'answers'> | null | undefined): TonightIndex {
  const a = plan?.answers as unknown as Record<string, unknown> | undefined;
  return a && (a.q20 === 'stock' || a.q20 === 'mixed') && a.q21 === 'tech_semis' ? 'sox' : 'nas100';
}
/** Tonight's one-day move of that index (the thermometer's own close-to-close move). Null when it is not known. */
export function tonightMove(snapshot: ThermometerSnapshot | undefined, index: TonightIndex): { date: string; changePercent: number; direction: TonightDirection } | null {
  const m = snapshot?.moves?.[index];
  if (!m || m.date !== snapshot?.asOf || !Number.isFinite(m.changePercent) || m.changePercent === 0) return null;
  return { date: m.date, changePercent: m.changePercent, direction: m.changePercent < 0 ? 'down' : 'up' };
}
/** The video chosen for the night (lib/resolute/tonight-videos.ts order: 0 深呼吸, 1 変わらないもの, 2 過去の下落).
 * Down night: 変わらないもの (what has not changed: your rules). Up night: 深呼吸 (slow down before buying more).
 * Unknown: 深呼吸. 過去の下落 stays one tap away. */
export function tonightVideo(direction: TonightDirection | null): number { return direction === 'down' ? 1 : 0; }

// ---------- これまでのあなた ----------
export type TonightAnswer = 'done' | 'skipped' | 'unsure';
export const TONIGHT_ANSWERS: readonly TonightAnswer[] = ['done', 'skipped', 'unsure'];
export type TonightNight = { night: string; stars: number | null; alert: boolean; answer: TonightAnswer | null };
/** total: rough nights (★4 or more, or a day an alert was delivered) on which the member opened this page, tonight included.
 * tonight: tonight is one of them. pastCalm: earlier rough nights answered 「計画どおり動いた」 or 「見送った」 in the morning note
 * (both mean no hasty order; 「まだ迷っている」 and no answer do not count). nights: the earlier ones, newest first, at most three. */
export type TonightRecord = { total: number; tonight: boolean; pastCalm: number; nights: TonightNight[] };
export const ANSWER_LABEL: Record<TonightAnswer, Copy> = {
  done: { ja: '計画どおり動いた', en: 'I followed my plan' }, skipped: { ja: '見送った', en: 'I held off' }, unsure: { ja: 'まだ迷っている', en: "I'm still unsure" },
};
export function isRoughNight(stars: number | null, alert: boolean) { return alert || (stars !== null && stars >= 4); }
/** The big count and the sentence made from the morning answers (only what the answers support). */
export function recordView(record: TonightRecord, locale: 'ja' | 'en') {
  const en = locale === 'en';
  const past = Math.max(0, record.total - (record.tonight ? 1 : 0)), calm = Math.min(record.pastCalm, past);
  let sentence: string;
  if (past === 0) sentence = en ? 'Tonight will be your first record.' : '今夜が1回目の記録になります';
  else if (calm === past) sentence = past === 1
    ? (en ? 'Last time, you reached the morning without placing a hasty order.' : 'これまでの1回は、慌てて注文せずに朝を迎えています')
    : (en ? `All ${past} times so far, you reached the morning without placing a hasty order.` : `これまでの${past}回は、${past}回とも慌てて注文せずに朝を迎えています`);
  else if (calm > 0) sentence = en ? `${calm} of your ${past} nights so far reached the morning without a hasty order.` : `これまでの${past}回のうち${calm}回は、慌てて注文せずに朝を迎えています`;
  else sentence = en ? `You have opened this page on ${past} rough night${past === 1 ? '' : 's'} before.` : `これまでに${past}回、荒れた夜にここを開いています`;
  return { count: record.tonight ? record.total : past, ordinal: record.tonight, sentence, first: past === 0 };
}

// ---------- 次にあなたが動くとき ----------
export type TonightLine = { symbol: string; kind: 'buy' | 'up'; price: number; pct: number };
/** Every alert line of every watched stock, from the reference price (the same formula as the closing alerts, alert-judge.ts). */
export function alertLines(settings: Pick<NotificationSettings, 'watchItems' | 'surgeCapPct'> | null | undefined, plan: Pick<PlanInput, 'buyLines'> | null | undefined): TonightLine[] {
  const out: TonightLine[] = [];
  for (const item of settings?.watchItems ?? []) {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(item.symbol) || !(item.referencePrice > 0)) continue;
    for (const l of plan?.buyLines ?? []) if (l.dropPct > 0 && l.dropPct < 100) out.push({ symbol: item.symbol, kind: 'buy', price: Math.round(item.referencePrice * (100 - l.dropPct)) / 100, pct: l.dropPct });
    if (settings?.surgeCapPct) out.push({ symbol: item.symbol, kind: 'up', price: Math.round(item.referencePrice * (100 + settings.surgeCapPct)) / 100, pct: settings.surgeCapPct });
  }
  return out;
}
/** The nearest line not yet reached: a buy line below the current price, or the rise line above it. Needs a current price. */
export function nearestLine(lines: readonly TonightLine[], prices: Readonly<Record<string, number | undefined>>): TonightLine | null {
  let best: TonightLine | null = null, gap = Infinity;
  for (const line of lines) {
    const price = prices[line.symbol];
    if (!(price! > 0)) continue;
    const away = line.kind === 'buy' ? (price! - line.price) / price! : (line.price - price!) / price!;
    if (away > 0 && away < gap) { best = line; gap = away; }
  }
  return best;
}
export function money(price: number) { return `$${Number.isInteger(price) ? price : price.toFixed(2)}`; }

// ---------- 今夜の3つの質問 ----------
/** One question and, under it, one of the member's own numbers. The note is never written by the AI: it is chosen by id from
 * notes built here from the member's saved rules and settings. */
export type TonightQuestion = { ask: Copy; note: Copy | null };
export type TonightQuestions = { night: string; source: 'ai' | 'fixed'; questions: TonightQuestion[] };
export type TonightNote = { id: string; ja: string; en: string };
export type TonightFacts = { direction: TonightDirection; index: TonightIndex; movePct: number; symbols: string[]; notes: TonightNote[] };
export const FIXED_QUESTIONS: Copy[] = [
  { ja: 'これは、あなたのルールに書いてあることですか？', en: 'Is this part of your written rules?' },
  { ja: '明日の朝も、同じ判断をしますか？', en: 'Would you make the same decision tomorrow morning?' },
  { ja: '暮らしのお金に影響しませんか？', en: 'Will it affect the money you live on?' },
];
/** The notes a question may carry, each with only the member's own numbers. */
export function tonightFacts(input: { direction: TonightDirection; index: TonightIndex; movePct: number; plan: Pick<PlanInput, 'tolerancePct' | 'perStockCapPct' | 'reserveMonths' | 'buyLines'> | null;
  settings: Pick<NotificationSettings, 'watchItems' | 'surgeCapPct' | 'deliveryHourJst' | 'morningEnabled'> | null }): TonightFacts {
  const { plan, settings } = input, notes: TonightNote[] = [];
  if (plan?.tolerancePct) notes.push({ id: 'tolerance', ja: `あなたは−${plan.tolerancePct}%までは持ち続けると決めています`, en: `You decided to hold on down to −${plan.tolerancePct}%` });
  if (plan?.perStockCapPct) notes.push({ id: 'cap', ja: `1銘柄は資産の${plan.perStockCapPct}%までと決めています`, en: `You keep each stock to ${plan.perStockCapPct}% of your assets` });
  if (plan?.reserveMonths) notes.push({ id: 'reserve', ja: `生活費の現金は${plan.reserveMonths}か月分残すと決めています`, en: `You keep ${plan.reserveMonths} months of living costs in cash` });
  if (settings?.morningEnabled) notes.push({ id: 'morning', ja: `翌朝のひとことは朝${settings.deliveryHourJst}:00に届きます`, en: `Your morning note arrives at ${deliveryClock(settings.deliveryHourJst, 'en')}` });
  const lines = alertLines(settings, plan);
  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.symbol}:${line.kind}`;
    if (seen.has(key)) continue; seen.add(key); // the first (shallowest) buy line and the rise line of each stock
    if (line.kind === 'buy') notes.push({ id: `buy-${line.symbol}`, ja: `次の買い増しは${line.symbol}が${money(line.price)}に届いた日です`, en: `Your next buy is the day ${line.symbol} reaches ${money(line.price)}` });
    else notes.push({ id: `up-${line.symbol}`, ja: `${line.symbol}は${money(line.price)}（+${line.pct}%）を上昇の目安にしています`, en: `Your rise line for ${line.symbol} is ${money(line.price)} (+${line.pct}%)` });
    if (notes.length >= 10) break;
  }
  return { direction: input.direction, index: input.index, movePct: Math.round(Math.abs(input.movePct) * 10) / 10, symbols: [...new Set((settings?.watchItems ?? []).map(i => i.symbol))].slice(0, 10), notes };
}
/** The fixed three (AI failed or not available), each with the member's note when they have one. */
export function fixedTonightQuestions(night: string, facts: Pick<TonightFacts, 'notes'>): TonightQuestions {
  const note = (...ids: string[]) => { for (const id of ids) { const n = facts.notes.find(x => x.id === id || id.endsWith('*') && x.id.startsWith(id.slice(0, -1))); if (n) return { ja: n.ja, en: n.en }; } return null; };
  return { night, source: 'fixed', questions: [
    { ask: FIXED_QUESTIONS[0], note: note('tolerance', 'cap') },
    { ask: FIXED_QUESTIONS[1], note: note('morning', 'buy-*') },
    { ask: FIXED_QUESTIONS[2], note: note('reserve') },
  ] };
}
/** The model request's instructions and data (sent by resolute-api; the AI writes only the questions and picks note ids). */
export function tonightPrompt(facts: TonightFacts): string {
  const feeling = facts.direction === 'down' ? 'the urge to sell in a panic' : 'the urge to buy more in excitement';
  return [
    'You write three short questions for a Japanese retail investor on a big market night, to help them calm down and follow their own saved rules.',
    `Tonight ${TONIGHT_INDEX_NAME[facts.index].en} moved ${facts.direction === 'down' ? 'down' : 'up'} ${facts.movePct}% in one day. Aim every question at ${feeling}.`,
    'Rules: never recommend buying or selling; never predict prices; ask, do not tell. Use no digits at all in the questions. You may name a ticker from "symbols".',
    'Japanese: natural, gentle, at most 28 characters, ending with "？". English: at most 70 characters, ending with "?". No ellipsis, no line breaks, no emoji.',
    'For each question pick the note id (from "notes") that fits it best, or null. Do not use the same note twice.',
    'Reply with JSON only: {"questions":[{"ja":"…","en":"…","note":"<id or null>"},{…},{…}]}',
    JSON.stringify({ symbols: facts.symbols, notes: facts.notes }),
  ].join('\n');
}
const BANNED = /買いましょう|売りましょう|買うべき|売るべき|買い時|売り時|今すぐ買|今すぐ売|必ず|絶対|上がります|下がります|you should (?:buy|sell)|buy now|sell now|will (?:rise|fall)/i;
/** Number provenance and shape: exactly three questions, no digits at all in the AI's text (every number on the page comes from the
 * notes built above), tickers only from the member's own list, a note id from the list or null (each at most once), within length,
 * a question mark at the end, no "…". Anything else: null, and the caller retries once, then uses the fixed three. */
export function parseTonightQuestions(text: unknown, facts: TonightFacts, night: string): TonightQuestions | null {
  if (typeof text !== 'string' || text.length > 4000) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list) || list.length !== 3) return null;
  const used = new Set<string>(), out: TonightQuestion[] = [];
  const symbols = new Set(facts.symbols), allowedLatin = new Set(['AI', 'ETF', 'TP']);
  for (const item of list) {
    const q = item as { ja?: unknown; en?: unknown; note?: unknown };
    if (typeof q.ja !== 'string' || typeof q.en !== 'string') return null;
    const ja = q.ja.normalize('NFKC').trim().replace(/\?$/, '？'), en = q.en.trim();
    if (ja.length < 6 || ja.length > 32 || en.length < 8 || en.length > 90 || !ja.endsWith('？') || !en.endsWith('?')) return null;
    if (/[0-9０-９]/.test(ja + en) || /…|\.\.\.|[\r\n]/.test(ja + en) || BANNED.test(ja + ' ' + en)) return null;
    for (const word of (ja.match(/[A-Za-z][A-Za-z.-]*/g) ?? [])) if (!symbols.has(word) && !allowedLatin.has(word)) return null;
    for (const word of (en.match(/\b[A-Z]{2,}[A-Z.-]*\b/g) ?? [])) if (!symbols.has(word) && !allowedLatin.has(word)) return null;
    let note: Copy | null = null;
    if (q.note !== null && q.note !== undefined && q.note !== 'null') {
      const n = facts.notes.find(x => x.id === q.note);
      if (!n || used.has(n.id)) return null;
      used.add(n.id); note = { ja: n.ja, en: n.en };
    }
    out.push({ ask: { ja, en }, note });
  }
  return { night, source: 'ai', questions: out };
}
