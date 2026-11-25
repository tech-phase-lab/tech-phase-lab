import type { RiskIndex } from './risk.ts';
import { namedCompanies, industryOf } from './risk-companies.ts';
/** Shock Gauge story scope (owner, Nov 25): which index a story is measured on, decided from its headline by fixed rules.
 * market  → TP大型株100 (market-wide: indexes, rates, macro data, tariffs, broad tech moves)
 * semis   → TP半導体40 (the semiconductor / AI-chip sector as a whole, export controls)
 * company → one company's news: measured on that company's stock AND its industry basket (risk-companies.ts), and starred
 *           only when both moved strongly (risk.ts companyQualifies). A headline that names one company is company news
 *           even when it mentions export controls or chip exports (Nov 25: 「SK hynixを巡る調査」 had been read as the sector).
 * The scope is a hint for which index to read and how to rank; the stars always come from measured moves.
 * Pure functions, plain regular expressions only: the same headline always gets the same scope. */
export type StoryScope = 'market' | 'semis' | 'company';

// A move verb splits a headline into its subject ("Chip stocks" / "Nvidia") and the rest.
const MOVE = /\b(?:fell|falls?|falling|drops?|dropped|dropping|slides?|slid|sliding|sinks?|sank|sinking|tumbl(?:e|es|ed|ing)|plung(?:e|es|ed|ing)|slump(?:s|ed|ing)?|declin(?:e|es|ed|ing)|los(?:e|es|t|ing)|retreat(?:s|ed|ing)?|tank(?:s|ed|ing)?|crash(?:es|ed|ing)?|rall(?:y|ies|ied|ying)|ris(?:e|es|ing)|rose|jump(?:s|ed|ing)?|soar(?:s|ed|ing)?|surg(?:e|es|ed|ing)|gain(?:s|ed|ing)?|climb(?:s|ed|ing)?|rebound(?:s|ed|ing)?|(?:is|are|was|were|trades?|trading|moves?|moving|ends?|ended|closes?|closed|opens?|opened|edges?|edged) (?:down|up|lower|higher|mixed)|sell-?offs?|selloffs?)\b|急落|暴落|続落|反落|下落|急騰|上昇|反発|続伸/i;
// Market-wide subjects: indexes, "stocks" / "Wall Street", broad tech and megacaps.
const MARKET = /\b(?:Nasdaq(?:-100| 100| Composite)?|S&P(?: 500)?|Dow(?: Jones)?|Wall Street|Russell 2000|stock markets?|equity markets?|Magnificent Seven|Mag(?:nificent)? 7|megacaps?|big tech|VIX)\b|^(?:the )?(?:U\.?S\.? |US |American |global |world |Asian |European |tech(?:nology)? |growth |large-?cap )?(?:stocks?|equities|shares|markets?|stock futures|futures|indexes|indices)$|米国株|米株|株式市場|ナスダック|ダウ平均|ハイテク株|米国市場/i;
// A headline that LEADS with the market as its subject ("Stocks give back part of Monday rally …", "U.S. stock futures slip …"):
// market-wide even when more words follow before the move verb. "Shares of X" is one company, never this.
const MARKET_LEAD = /^(?:the )?(?:U\.?S\.? |US |American |global |world |Asian |European |tech(?:nology)? |growth |large-?cap )?(?:stocks?|equities|stock markets?|markets?|stock futures|equity futures|futures|indexes|indices)\b(?! of\b)/i;
// The semiconductor sector as a whole (never one company whose name contains "Semiconductor").
const SEMIS = /\b(?:chip ?stocks?|chip shares|chip ?makers?|chip sector|chip(?:-making)? equipment|semiconductor (?:stocks?|shares|sector|index|industry|equipment|tariffs?|names)|semis|SOX|Philadelphia Semiconductor|AI (?:chip|infrastructure|hardware) (?:stocks?|shares|names|sector|trade)|memory (?:chip )?(?:stocks?|makers|prices|shortage)|HBM (?:shortage|prices|supply)|export (?:controls?|curbs?|restrictions?|bans?|rules?)|chip (?:exports?|curbs?|tariffs?|bans?))\b|半導体株|半導体関連株|半導体指数|半導体業界|半導体関税|AIインフラ株|輸出規制|対中規制|半導体規制/i;
// Market-wide drivers: central bank, rates, macro data, trade policy, broad AI spending.
const MACRO = /\b(?:Fed|Federal Reserve|FOMC|Powell|rate (?:cuts?|hikes?|decision|path|outlook)|interest rates?|Treasur(?:y|ies)|bond yields?|yields|inflation|CPI|PCE|PPI|jobs report|payrolls|jobless claims|unemployment|GDP|retail sales|consumer (?:confidence|sentiment|spending)|recession|tariffs?|trade (?:war|deal|talks)|sanctions?|government shutdown|debt ceiling|oil prices?|crude|dollar|geopolitic\w*|AI bubble|AI (?:capex|spending)|hyperscalers?(?:'|’)? (?:capex|spending)|capex)\b|利上げ|利下げ|政策金利|長期金利|インフレ|雇用統計|消費者物価|関税|景気後退|米国債|FRB|FOMC/i;

/** The headline's subject: the words before its first move verb (empty when there is none). */
export function headlineSubject(title: string): string {
  const m = MOVE.exec(title);
  return m ? title.slice(0, m.index).replace(/[\s,:'’-]+$/, '').trim() : '';
}

/** Fixed rule, in this order. A headline whose subject moved ("X falls 5%") is about that subject: an index or "stocks" is market,
 * the chip sector is semis, a named company is company, a rate / yield / macro subject is market, and any other subject is
 * company. A headline without a move verb is company when it names a company, else market when it names an index or a macro
 * driver, semis when it names the chip sector, otherwise company. */
// A company whose name ends in "Semiconductor" (Navitas Semiconductor, Taiwan Semiconductor) is one company, not the sector.
const COMPANY_SEMICONDUCTOR = /\b(?!(?:Philadelphia|US|U\.S\.|Global|Asian|European|Japanese|Korean|Taiwanese|Chinese|The)\b)[A-Z][\w.&-]*(?: [A-Z][\w.&-]*)* Semiconductors?\b/g;
export function storyScope(title: string): StoryScope {
  const t = typeof title === 'string' ? title.normalize('NFKC').replace(COMPANY_SEMICONDUCTOR, 'Company') : '';
  const subject = headlineSubject(t);
  if (subject) {
    if (MARKET.test(subject) || MARKET_LEAD.test(subject)) return 'market';
    if (SEMIS.test(subject)) return 'semis';
    if (namedCompanies(subject).length) return 'company';
    if (MACRO.test(subject)) return 'market';
    return 'company';
  }
  if (namedCompanies(title).length) return 'company';
  if (MARKET.test(t) || MARKET_LEAD.test(t)) return 'market';
  if (SEMIS.test(t)) return 'semis';
  if (MACRO.test(t)) return 'market';
  return 'company';
}
export function scopeIndex(scope: StoryScope): RiskIndex | 'company' {
  return scope === 'market' ? 'nas100' : scope === 'semis' ? 'sox' : 'company';
}

// A cause in the headline: "as …", "after …", "amid …", "on <noun>", a colon or dash clause, a Japanese clause after 、.
const CAUSE = /\b(?:as|after|amid|following|over|despite|because|due to|ahead of|while|since|post|on (?!(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|the day|heavy volume)\b)\w)\b|[:;—–]|\s-\s|、|を受け|受けて|ため|により|懸念/i;
/** 1 when the headline names a cause ("as …", "after …", "amid …", a colon clause), else 0: a tie-break between stories on the
 * same move (the one that says why it moved explains it better). */
export function headlineCause(title: string): number { return CAUSE.test(typeof title === 'string' ? title.normalize('NFKC') : '') ? 1 : 0; }
const MOVE_SIZE = /\d+(?:\.\d+)?\s*%|\bpre-?market\b|\bafter-?hours\b|\bpremarket\b|プレマーケット|時間外|寄り付き前/i;
/** "Nvidia falls 5.6% in premarket" (owner, Nov 25: 「NVDA3つもいらん」): a price move with a size or a premarket / after-hours
 * label and no cause. Such a recap says only that a price moved, and is never shown. */
export function isBarePriceMove(title: string): boolean {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  return MOVE.test(t) && MOVE_SIZE.test(t) && !CAUSE.test(t);
}

/** The measurable company of a single-company story (owner, Nov 25), or null when it is not one the thermometer prices:
 * 1. a rostered company named in the headline's subject ("Nvidia shares slide …");
 * 2. else the source's primary ticker (its first), when rostered ("Cipher Digital … as Nvidia selloff …" is CIFR: not measured);
 * 3. else, without tickers, the first rostered company the headline names (「SKハイニックスを巡る調査」 → SKHY). */
export function storyTicker(story: { title: string; tickers?: readonly string[] }): string | null {
  const title = typeof story.title === 'string' ? story.title.normalize('NFKC') : '';
  const inSubject = namedCompanies(headlineSubject(title))[0];
  if (inSubject) return inSubject;
  if (story.tickers?.length) return industryOf(story.tickers[0]) ? story.tickers[0] : null;
  return namedCompanies(title)[0] ?? null;
}
/** The company a single-company story is about: its first listed ticker, else the headline subject's first word. */
export function companyKey(story: { title: string; tickers?: readonly string[] }): string {
  if (story.tickers?.length) return story.tickers[0];
  const subject = headlineSubject(story.title.normalize('NFKC')) || story.title.normalize('NFKC');
  return (subject.match(/[A-Za-z][A-Za-z0-9.&]+|[^\s株が]+/)?.[0] ?? subject).toLowerCase();
}

const words = (title: string) => new Set(title.normalize('NFKC').toLowerCase().replace(/\d+(?:\.\d+)?%?/g, ' ').split(/[^a-z぀-ヿ一-鿿]+/).filter(w => w.length >= 3));
/** Word overlap of two headlines (Jaccard, numbers ignored): 0.5 or more is the same story told twice. */
export function titleSimilarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / (x.size + y.size - same);
}
export const NEAR_DUPLICATE = 0.5;
