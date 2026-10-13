// RESOLUTE ③④ 通知メールの文面(日英)。法務確認の前の下書き。
// 方針: 主語は「あなたの計画では」。売買を指示しない。将来を断定しない。
// 英語は、堅くならない自然な話し言葉で書く。

import type { AlertEvent } from './alert-judge.ts';

export type Locale = 'ja' | 'en';

export interface RenderedMail {
  subject: string;
  text: string;
}

export interface AlertMailInput {
  locale: Locale;
  date: string; // 米国市場の営業日 YYYY-MM-DD
  items: AlertEvent[];
  planUrl: string;
  unsubscribeUrl: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD を読みやすい日付にする。形式が違えばそのまま返す。 */
export function formatDate(date: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return date;
  return locale === 'ja' ? `${month}月${day}日` : `${MONTHS[month - 1]} ${day}`;
}

function pct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) throw new RangeError('event is missing a percentage');
  return String(n);
}

function lineJa(e: AlertEvent): string {
  if (e.kind === 'line_reached') {
    const lines = (e.newLines ?? []).map((l) => `-${l}%`).join('、');
    return `・${e.symbol}:終値 ${usd(e.close)}(基準から -${pct(e.dropPct)}%)/新しく届いたライン ${lines}`;
  }
  return `・${e.symbol}:終値 ${usd(e.close)}(基準から +${pct(e.risePct)}%)/決めておいた上昇の目安に届きました`;
}

function lineEn(e: AlertEvent): string {
  if (e.kind === 'line_reached') {
    const lines = (e.newLines ?? []).map((l) => `-${l}%`).join(', ');
    return `- ${e.symbol}: closed at ${usd(e.close)}, down ${pct(e.dropPct)}% from your reference price. Newly reached levels: ${lines}`;
  }
  return `- ${e.symbol}: closed at ${usd(e.close)}, up ${pct(e.risePct)}% from your reference price. That reaches the upside threshold you set.`;
}

export function renderAlertMail(i: AlertMailInput): RenderedMail {
  if (i.items.length === 0) throw new RangeError('items must not be empty');
  const hasLine = i.items.some((e) => e.kind === 'line_reached');
  const hasSurge = i.items.some((e) => e.kind === 'surge_cap');

  if (i.locale === 'ja') {
    const subject =
      hasLine && hasSurge
        ? '【RESOLUTE】あなたの計画のラインと上昇の目安に届いた銘柄があります'
        : hasLine
          ? '【RESOLUTE】あなたの計画のラインに届いた銘柄があります'
          : '【RESOLUTE】あなたの計画の上昇の目安に届いた銘柄があります';
    const notes: string[] = [];
    if (hasLine) notes.push('あなたの計画では 下落のラインは決めておいたルールを見直す合図です');
    if (hasSurge) notes.push('あなたの計画では 上昇の目安は持ち分の偏りを確認する合図です');
    return {
      subject,
      text: [
        ...notes,
        '',
        `${formatDate(i.date, 'ja')}(米国市場)の終値をあなたの計画と照らしました`,
        '',
        ...i.items.map(lineJa),
        '',
        '計画に書いた買い増し額と買わない条件を確認してください。上昇時は1銘柄の上限も確認できます',
        '',
        `計画を開く:${i.planUrl}`,
        '',
        '---',
        'RESOLUTEの終値通知をご利用中のため、このメールをお送りしています。情報の提供であり、投資助言ではありません。',
        `配信停止:${i.unsubscribeUrl}`,
      ].join('\n'),
    };
  }

  const subject =
    hasLine && hasSurge
      ? '[RESOLUTE] Your downside and upside thresholds were reached'
      : hasLine
        ? '[RESOLUTE] A price level in your plan was reached'
        : '[RESOLUTE] An upside threshold in your plan was reached';
  const notes: string[] = [];
  if (hasLine) notes.push('In your plan, a downside level like this is your cue to pause and reread the rules you wrote for yourself.');
  if (hasSurge) notes.push('In your plan, an upside threshold is your cue to check whether one holding has grown too big.');
  return {
    subject,
    text: [
      ...notes,
      '',
      `Quick note after the US close on ${formatDate(i.date, 'en')}. We checked the closing prices against your plan:`,
      '',
      ...i.items.map(lineEn),
      '',
      'Check your planned purchase amounts and conditions for not buying. After a rise, check your single-stock cap too.',
      '',
      `Open your plan: ${i.planUrl}`,
      '',
      '---',
      "You're getting this because your RESOLUTE alerts are on. It's information only, not investment advice.",
      `Unsubscribe: ${i.unsubscribeUrl}`,
    ].join('\n'),
  };
}

export interface NextMorningInput {
  locale: Locale;
  doneUrl: string; // 実行した
  skippedUrl: string; // 見送った
  unsureUrl: string; // まだ迷っている
  planUrl: string;
  unsubscribeUrl: string;
}

export function renderNextMorningMail(i: NextMorningInput): RenderedMail {
  if (i.locale === 'ja') {
    return {
      subject: '【RESOLUTE】昨日のお知らせのあと、どうでしたか?',
      text: [
        '昨日のお知らせから\n一晩が経ちました',
        '今の気持ちに近いものを\n1つだけ選んでください',
        '',
        `・計画どおり動いた:${i.doneUrl}`,
        `・見送った:${i.skippedUrl}`,
        `・まだ迷っている:${i.unsureUrl}`,
        '',
        '選ぶと今の気持ちに合わせたルールの見直し方を確認できます',
        `計画を開く:${i.planUrl}`,
        '',
        '---',
        'このメールは、昨日のお知らせについて1回だけお送りしています。投資助言ではありません。',
        `配信停止:${i.unsubscribeUrl}`,
      ].join('\n'),
    };
  }
  return {
    subject: "[RESOLUTE] How are you feeling after yesterday's alert?",
    text: [
      "Quick check-in on yesterday's alert.",
      "Choose the response that best describes how you feel right now.",
      '',
      `- I followed my plan: ${i.doneUrl}`,
      `- I held off: ${i.skippedUrl}`,
      `- I'm still unsure: ${i.unsureUrl}`,
      '',
      'Your answer opens a short tip to help you review your rules.',
      `Open your plan: ${i.planUrl}`,
      '',
      '---',
      "We send this once per alert. It's information only, not investment advice.",
      `Unsubscribe: ${i.unsubscribeUrl}`,
    ].join('\n'),
  };
}
