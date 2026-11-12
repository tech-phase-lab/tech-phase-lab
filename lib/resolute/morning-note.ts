// RESOLUTE ④ 翌朝のひとこと(リゼルのひとこと)。事実性を最優先にした短い1文。
// 材料は、直前に受け付けられた③のお知らせ(銘柄・終値・下落率/上昇率)だけ。
// 失敗しても必ず出せるよう、定型の文を既定にする。AIを使う場合も、検証に通った文だけを使い、
// 通らなければ定型に戻す(AI呼び出し自体はここに含めず、承認と費用上限の確認後に generate を渡す)。
import type { AlertEvent } from './alert-judge.ts';
import type { Locale } from './mail-templates.ts';

export type NoteFacts = Pick<AlertEvent, 'kind' | 'symbol' | 'close' | 'dropPct' | 'risePct'>[];

const usd = (n: number) => `$${n.toFixed(2)}`;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** 材料として使える形か。使えない項目は除く(推測で補わない)。 */
export function usableFacts(events: unknown): NoteFacts {
  if (!Array.isArray(events)) return [];
  const out: NoteFacts = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const v = e as Record<string, unknown>;
    if (typeof v.symbol !== 'string' || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(v.symbol) || !finite(v.close) || v.close <= 0) continue;
    if (v.kind === 'line_reached' && finite(v.dropPct)) out.push({ kind: 'line_reached', symbol: v.symbol, close: v.close, dropPct: v.dropPct });
    else if (v.kind === 'surge_cap' && finite(v.risePct)) out.push({ kind: 'surge_cap', symbol: v.symbol, close: v.close, risePct: v.risePct });
  }
  return out.slice(0, 20);
}

function one(f: NoteFacts[number], locale: Locale): string {
  if (f.kind === 'line_reached') {
    return locale === 'ja'
      ? `${f.symbol}(終値 ${usd(f.close)}、基準から -${f.dropPct}%)`
      : `${f.symbol} (closed at ${usd(f.close)}, down ${f.dropPct}% from your reference price)`;
  }
  return locale === 'ja'
    ? `${f.symbol}(終値 ${usd(f.close)}、基準から +${f.risePct}%)`
    : `${f.symbol} (closed at ${usd(f.close)}, up ${f.risePct}% from your reference price)`;
}

const FALLBACK: Record<Locale, string> = {
  ja: '昨日のお知らせから一晩が経ちました。急いで決めなくて大丈夫です。計画に書いたルールを、もう一度ゆっくり読んでみてください。',
  en: "It's been a night since yesterday's alert. There's no rush. Take a quiet moment to reread the rules you wrote in your plan.",
};

/** 定型の文。事実は渡された値だけを使う。材料が空なら、数字を含まない短い文を返す。 */
export function templateNote(events: unknown, locale: Locale): string {
  const facts = usableFacts(events);
  if (!facts.length) return FALLBACK[locale];
  const shown = facts.slice(0, 2).map((f) => one(f, locale));
  const rest = facts.length - shown.length;
  const hasLine = facts.some((f) => f.kind === 'line_reached');
  if (locale === 'ja') {
    const head = `昨日のお知らせは ${shown.join('、')}${rest > 0 ? `、ほか${rest}銘柄` : ''} でした。`;
    const tail = hasLine
      ? 'あなたの計画に書いた買い増し額と、買わない条件を読み直してから、ゆっくり考えて大丈夫です。'
      : 'あなたの計画に書いた1銘柄の上限を確認してから、ゆっくり考えて大丈夫です。';
    return head + tail;
  }
  const head = `Yesterday's alert was about ${shown.join(' and ')}${rest > 0 ? `, plus ${rest} more` : ''}. `;
  const tail = hasLine
    ? 'There is no rush. Reread the purchase amounts and the conditions for not buying that you wrote in your plan.'
    : 'There is no rush. Check the single-stock cap you wrote in your plan.';
  return head + tail;
}

const BANNED =
  /買うべき|売るべき|買い時|売り時|おすすめ|オススメ|必ず|絶対|儲|確実|上がる|下がる|buy now|sell now|you should buy|you should sell|guaranteed|will rise|will fall|recommend/i;

/** AIの文を使う前の検証。事実にない数字・銘柄・URL・助言の言い回しは不可。 */
export function acceptModelNote(value: unknown, events: unknown, locale: Locale): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > (locale === 'ja' ? 120 : 280) || /[\r\n]/.test(text) || /https?:|@|<|>/.test(text) || BANNED.test(text)) return null;
  const facts = usableFacts(events);
  if (!facts.length) return null;
  const allowed = new Set<string>();
  for (const f of facts) {
    allowed.add(f.close.toFixed(2));
    allowed.add(String(f.kind === 'line_reached' ? f.dropPct : f.risePct));
  }
  for (const m of text.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.has(m)) return null;
  for (const s of text.match(/\b[A-Z][A-Z0-9.-]{1,14}\b/g) ?? []) {
    if (!facts.some((f) => f.symbol === s) && !['JST', 'USD'].includes(s)) return null;
  }
  return text;
}

/** generate は {"note": string} だけの厳密なJSON文字列を返す関数(任意)。失敗・不正・検証不合格は、すべて定型に戻す。 */
export async function composeMorningNote(input: {
  events: unknown;
  locale: Locale;
  generate?: (facts: NoteFacts, locale: Locale) => Promise<string>;
}): Promise<{ text: string; source: 'model' | 'template' }> {
  if (input.generate) {
    try {
      const parsed = JSON.parse(await input.generate(usableFacts(input.events), input.locale)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1) {
        const accepted = acceptModelNote((parsed as { note?: unknown }).note, input.events, input.locale);
        if (accepted) return { text: accepted, source: 'model' };
      }
    } catch {
      /* 定型に戻す */
    }
  }
  return { text: templateNote(input.events, input.locale), source: 'template' };
}

/** 翌朝メール本文の先頭へ、ひとことを差し込む(承認済みの既存テンプレートは変更しない)。 */
export function withMorningNote(mail: { subject: string; text: string }, note: string): { subject: string; text: string } {
  if (!note || /[\r\n]/.test(note)) throw new RangeError('invalid note');
  return { subject: mail.subject, text: `${note}\n\n${mail.text}` };
}

/** 価格データの出典表示(提供: Twelve Data)。署名付き配信停止の行より前に置く。 */
export function withProviderCredit(mail: { subject: string; text: string }, locale: Locale): { subject: string; text: string } {
  const credit = locale === 'ja' ? '価格データ提供: Twelve Data' : 'Price data provided by Twelve Data';
  const at = mail.text.lastIndexOf('\n---\n');
  const text = at < 0 ? `${mail.text}\n\n${credit}` : `${mail.text.slice(0, at)}\n\n${credit}${mail.text.slice(at)}`;
  return { subject: mail.subject, text };
}
