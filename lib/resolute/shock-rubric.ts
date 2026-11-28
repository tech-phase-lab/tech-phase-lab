import { headlinePercent } from './risk-edition.ts';
import { storyScope } from './risk-scope.ts';
/** The Shock Gauge ★ rubric (owner, Nov 28: "a new-tariff story got ★1"). One table, used by the AI ranker (its instructions list
 * the rubric and every story carries its own range; a ★ outside the range is moved to the nearest end) and by the rule fallback
 * when the AI is unavailable (the range's usual ★, or the measured move's table ★ kept inside the range).
 *
 * ★ is about how hard the news itself shakes the whole U.S. market or the stock:
 *   ★5  shakes the whole market very hard (a war or the Strait of Hormuz closing, a market crash)
 *   ★4  shakes the whole market or a mega-cap stock hard (new tariffs / a trade war, a Fed surprise, a mega-cap CEO exit)
 *   ★3  clearly moves the market or a sector (a Fed decision, inflation / jobs data, a mega-cap downgrade, an oil shock)
 *   ★2  moves one company's stock (its earnings, an executive change, a deal or a downgrade of a smaller company)
 *   ★1  routine (analyst notes and price targets, product news, commentary)
 * Pure and browser-safe. Plain regular expressions only. */
export type RubricRule = { key: string; ja: string; en: string; min: number; max: number; usual: number; test: (t: string, mega: boolean) => boolean };
/** Mega-cap names and tickers (the largest U.S. stocks by market value: their news moves the indexes). */
const MEGA = /\b(?:Apple|AAPL|Microsoft|MSFT|Nvidia|NVDA|Alphabet|Google|GOOGL?|Amazon|AMZN|Meta|META|Tesla|TSLA|Broadcom|AVGO|TSMC|TSM|Berkshire|JPMorgan|Eli Lilly)\b|アップル|マイクロソフト|エヌビディア|アルファベット|グーグル|アマゾン|メタ|テスラ|ブロードコム/i;
const WAR = /\b(?:war|invasion|invades?|invaded|missile|airstrikes?|military strikes?|attack(?:s|ed)? on|Strait of Hormuz|Hormuz|blockade)\b|戦争|侵攻|ミサイル|空爆|軍事攻撃|ホルムズ|海峡封鎖/i;
const CRASH = /\b(?:crash\w*|plung\w*|tumbl\w*|routs?|sell(?:-| )?offs?|nosediv\w*|freefall|circuit breaker|worst day)\b|暴落|急落|サーキットブレーカー/i;
const TRADE = /\b(?:tariffs?|duties|trade war|retaliat\w*|countermeasures?|export (?:controls?|curbs?|bans?)|chip ban|sanctions?)\b|関税|貿易戦争|貿易摩擦|報復|対抗措置|輸出規制|制裁/i;
const CENTRAL = /\b(?:Fed|FOMC|Federal Reserve|Powell|BOJ|Bank of Japan|ECB)\b|FRB|日銀|連邦準備|パウエル/i;
const POLICY = /\b(?:rates?|hikes?|cuts?|holds?|decision|meeting|minutes|policy|tighten\w*|eas(?:e|ing))\b|金利|利上げ|利下げ|据え置き|会合|政策/i;
const SURPRISE = /\b(?:surpris\w*|unexpected\w*|emergency|shock\w*|jumbo|unscheduled)\b|予想外|サプライズ|緊急|大幅利/i;
const RECESSION = /\b(?:recessions?|depression|default|bank run|bank failure|financial crisis)\b|リセッション|景気後退|恐慌|デフォルト|金融危機|取り付け/i;
const MACRO = /\b(?:CPI|PCE|inflation|jobs report|payrolls|unemployment|jobless|GDP|retail sales|PMI|ISM|consumer confidence|Treasury yields?|bond yields?)\b|インフレ|物価|雇用統計|失業率|GDP|小売売上高|国債利回り|長期金利/i;
const OIL = /\b(?:oil|crude|OPEC\+?|Brent|WTI)\b|原油|OPEC/i;
const EXIT = /\b(?:resign\w*|step(?:s|ping)? down|stepped down|ousted|ouster|fired|retir\w+|depart\w*|exits?)\b|辞任|退任|解任/i;
const EXEC = /\b(?:CEO|CFO|COO|chair\w*|chief executive|founder|president)\b|CEO|最高経営責任者|会長|社長|創業者/i;
const DOWNGRADE = /\b(?:downgrad\w*|creditwatch negative|negative outlook|outlook (?:to )?negative|cut to (?:sell|underperform|underweight|junk))\b|格下げ|ネガティブ/i;
const RESULTS = /\b(?:earnings|results|revenue|guidance|forecast|outlook|profit warning|quarter(?:ly)?)\b|決算|売上高|業績|見通し|ガイダンス/i;
const ROUTINE = /\b(?:price target|initiat\w* coverage|reiterat\w*|maintains?|analyst says|analysts? (?:see|say|expect)|top picks?|buy rating|overweight rating|stock to watch|unveils?|launch\w*|partnership|opens? new)\b|目標株価|格付け維持|新製品|発表会/i;
const INDEX = /\b(?:Nasdaq|S&P 500|Dow|stocks|Wall Street|chip stocks|semiconductors?|SOX)\b|ナスダック|ダウ|米国株|米株|半導体株|日経平均/i;
/** Order: the first matching rule is the story's type. */
export const SHOCK_RUBRIC: readonly RubricRule[] = [
  { key: 'war', ja: '戦争・軍事衝突・ホルムズ海峡', en: 'war, military conflict, Hormuz', min: 4, max: 5, usual: 5, test: t => WAR.test(t) },
  { key: 'crash', ja: '相場の急落', en: 'a market crash or sell-off', min: 4, max: 5, usual: 4, test: t => CRASH.test(t) && storyScope(t) !== 'company' },
  { key: 'trade', ja: '新しい関税・貿易摩擦・輸出規制', en: 'new tariffs, trade war, export controls', min: 3, max: 5, usual: 4, test: t => TRADE.test(t) },
  { key: 'fed-surprise', ja: '中央銀行の予想外の決定', en: 'a central-bank surprise', min: 4, max: 5, usual: 4, test: t => CENTRAL.test(t) && SURPRISE.test(t) },
  { key: 'recession', ja: '景気後退・金融危機', en: 'recession or financial crisis', min: 3, max: 5, usual: 4, test: t => RECESSION.test(t) },
  { key: 'megacap-exit', ja: '巨大企業の経営トップの交代', en: 'a mega-cap CEO exit', min: 4, max: 5, usual: 4, test: (t, mega) => mega && EXIT.test(t) && EXEC.test(t) },
  { key: 'index-move', ja: '主要指数の大きな下げ・上げ', en: 'a major index move of 2% or more', min: 3, max: 5, usual: 3, test: t => INDEX.test(t) && storyScope(t) !== 'company' && (headlinePercent(t) ?? 0) >= 2 },
  { key: 'fed', ja: '中央銀行の金融政策', en: 'a central-bank decision', min: 3, max: 5, usual: 3, test: t => CENTRAL.test(t) && POLICY.test(t) },
  { key: 'megacap-downgrade', ja: '巨大企業の格下げ', en: 'a downgrade of a mega-cap', min: 3, max: 4, usual: 3, test: (t, mega) => mega && DOWNGRADE.test(t) },
  { key: 'macro', ja: '物価・雇用・金利の指標', en: 'inflation, jobs or yields data', min: 2, max: 4, usual: 3, test: t => MACRO.test(t) || CENTRAL.test(t) },
  { key: 'oil', ja: '原油価格', en: 'oil prices', min: 2, max: 4, usual: 3, test: t => OIL.test(t) },
  { key: 'exec-exit', ja: '経営トップの交代', en: 'an executive exit', min: 2, max: 4, usual: 3, test: t => EXIT.test(t) && EXEC.test(t) },
  { key: 'downgrade', ja: '格下げ', en: 'a downgrade', min: 2, max: 3, usual: 2, test: t => DOWNGRADE.test(t) },
  { key: 'megacap-results', ja: '巨大企業の決算', en: 'mega-cap earnings', min: 2, max: 4, usual: 3, test: (t, mega) => mega && RESULTS.test(t) },
  { key: 'routine', ja: 'アナリストの見方・製品などの通常のニュース', en: 'routine analyst notes or product news', min: 1, max: 2, usual: 1, test: t => ROUTINE.test(t) },
  { key: 'results', ja: '1社の決算', en: 'one company\'s earnings', min: 1, max: 3, usual: 2, test: t => RESULTS.test(t) },
];
/** A story with no listed type. */
export const OTHER_RULE: RubricRule = { key: 'other', ja: 'その他のニュース', en: 'other news', min: 1, max: 3, usual: 2, test: () => true };
/** The story's rubric type (from its headline and tickers). */
export function rubricFor(title: string, tickers: readonly string[] = []): RubricRule {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  const mega = MEGA.test(t) || tickers.some(x => MEGA.test(x));
  return SHOCK_RUBRIC.find(r => r.test(t, mega)) ?? OTHER_RULE;
}
export const clampStars = (n: number, r: RubricRule) => Math.max(r.min, Math.min(r.max, Math.round(n)));
/** The ★ the rubric suggests: the measured move's table ★ (when the story's session has closed) kept inside the type's range,
 * else the type's usual ★. */
export function rubricStars(title: string, tickers: readonly string[] = [], measured: number | null = null): number {
  const r = rubricFor(title, tickers);
  return clampStars(typeof measured === 'number' && Number.isFinite(measured) ? measured : r.usual, r);
}
/** The rubric as the AI ranker's instructions state it. */
export const RUBRIC_TEXT = 'Star rubric (stars 1–5 by how hard the news itself shakes the whole U.S. market or the stock): '
  + '5 = shakes the whole market very hard (war, the Strait of Hormuz, a market crash); 4 = shakes the market or a mega-cap stock hard (new tariffs or a trade war, a Fed surprise, a mega-cap CEO exit); '
  + '3 = clearly moves the market or a sector (a Fed decision, inflation or jobs data, a mega-cap downgrade, an oil shock, a major index move of 2% or more); '
  + '2 = moves one company\'s stock (its earnings, an executive change, a smaller company\'s downgrade); 1 = routine (analyst notes, price targets, product news). '
  + 'Each story carries "rubric": its type and allowed range {min,max}; choose stars inside that range, higher when the measured move is large.';
