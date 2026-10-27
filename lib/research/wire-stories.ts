import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import { tidyJapanese } from "./ja-text.ts";
import { calendarEvents, dateOnlyEarnings } from "./calendar.ts";

/** Company headlines as stories (owner, Oct 17): the same story arrives for several companies and from
 * several publishers, and the lists showed it five times. One story is one row, listing every company it
 * names; headlines that are not news about the company (community posts, "stocks to buy" lists, fund
 * trades) are left out. */
export type WireStory = { id: string; tickers: string[]; title: string; url: string; publisher: string; origin: CompanyWireItem["origin"]; at: string };

const NOT_NEWS = [
  /\$[^$\n]{1,80}\([A-Z.]{1,8}\.US\)\$/,                       // community posts: $NVIDIA (NVDA.US)$
  /\bNet ETF (?:Buying|Selling)\b|\bETFs? Are (?:Buying|Selling)\b|^Lobbying Update\b/i,
  /\b(?:ETF|Trust|Fund)\b.{0,60}\b(?:Buys|Sells|Bought|Sold)\b.{0,60}\bon\b/i,
  /\bZacks (?:Analyst Blog|Investment Ideas)\b|\bTake five\b|\blifetime access\b|\bfor one \$\d+ payment\b|\bBC-Most Active\b/i,
  /\bForecast\s+[—–-]\s+Price Target\b|\bPrediction for 20\d\d\b/i,
  /\b\d+ (?:Top |Best )?(?:AI |Tech |Dividend |Growth )?Stocks? (?:to Buy|You Can)\b|\bBest .{0,24}Stocks? to Buy\b|\bBetter (?:AI |Tech )?Stock:|\bToo Late to Buy\b|\bBuy Now and Hold\b|\bShould You Buy\b|\bDon.t miss\b/i,
  /\bETFs?\b.{0,50}\b(?:buy|buys|smartest|best)\b|\b(?:buy|buys)\b.{0,30}\bETFs?\b|\b(?:if|when) (?:you|the stock market).{0,40}(?:\$1,?000\b|\bcrash|\bplunge)|\bhistory shows\b/i, // "buy these ETFs" advice: no detail to open
  /\bDisney\b.{0,40}\bCharacter\.AI\b/i,
  /株式市場の暴落.{0,20}ETF|ETFを買い|ETFが最も賢い|ディズニー.{0,10}Character\.AI/,
  /\bhere.s why\b|\bthis is why\b|\bthe (?:real |main |simple |surprising )?reasons? (?:why|that|behind)\b|\b(?:and )?why\b.{0,80}\b(?:reasons?)\b/i, // teasers whose answer is not in the headline
  /\?\s*$/, // a headline that asks a question has no fact in it
  /[？?]\s*$/,
  /^why\b/i, // "Why …" headlines give the reason only in the article
  /^なぜ|のか$|でしょうか$|だろうか$/,
  /理由$|その理由|理由とは|なぜ.{0,40}[？?]$/,
  /\bbuying opportunit(?:y|ies)\b|\bbuy the dip\b|\btime to buy\b|買いの機会|買い時|買い場|押し目買い/i, // opinion pieces that argue for buying carry no news fact
  /逃した[?？]|見逃さない(?:よう|で)|お気に入りの恐竜/,
  /\bweek in review\b|\bweekly (?:news )?(?:roundup|digest|recap|wrap)\b|\bthis week(?:['’]s)? (?:top|key|main|biggest|major)\b|\bwhat happened this week\b|今週の(?:主な)?(?:動向|ニュース|まとめ)|週間(?:まとめ|ニュース|動向)/i, // weekly digests read as a teaser for a longer piece
  /\bwhat (?:it|this|that) means for\b|\bwhat (?:it|this) (?:could )?mean(?:s)? for (?:investors|the stock)\b|(?:株|社|銘柄)?(?:にとっての意味|に与える影響とは|が意味すること|は何を意味|にとって何を意味)\s*$/i, // teasers: the answer is in an article we do not carry (owner, Oct 26)
  /(?:\b(?:EUR|GBP|CHF)\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|GBP|CHF)\b|(?:ユーロ|ポンド)\s?\d[\d.,]*).{0,12}(?:で取引|\btrad)|\btrad\w*\b.{0,24}\b(?:EUR|GBP|CHF)\s?\d/i, // a foreign-currency quote, not news
  /\b(?:Bronstein,? Gewirtz|Rosen Law|Pomerantz|Levi & Korsinsky|Faruqi|Glancy Prongay|Schall Law|Gross Law|Kessler Topaz|Johnson Fistel|Block & Leviton)\b|ブロンスタイン|ローゼン法律|ポメランツ|株主に対し.{0,20}(?:調査|問い合わせ)|\b(?:encourages?|urges?|reminds?) (?:shareholders|investors)\b|\binvestors? who (?:lost|suffered)\b/i, // law-firm solicitations (owner, Oct 26)
  /\bshareholder alert\b|\blead plaintiff\b|\bclass action\b.{0,60}\b(?:deadline|lawsuit|filed)\b|株主向け警告|リード原告|集団訴訟.{0,20}(?:期限|締切)/i, // law-firm lead-plaintiff notices (owner, Oct 27)
  /\b(?:tracking|following|eyeing)\b.{0,50}\bearnings\b|決算を追う|ウォール街が(?:ラリー|反発|続伸|下落|急落)|\bWall Street (?:rallies|rally mode|slides|falls|climbs|stabili[sz]es)\b/i, // other companies' earnings round-ups and market-wide wraps
  /\bearnings preview\b|\b(?:Q[1-4]|quarter(?:ly)?) (?:earnings )?preview\b|\bwhat to (?:expect|watch)\b|\bwhat (?:investors )?should (?:you )?expect\b|\bkey things to watch\b|\b(?:set|slated|scheduled) to (?:report|release|announce)\b.{0,60}\btomorrow\b|\b(?:reports?|releases?) (?:Q[1-4]|\w+ quarter) (?:results|earnings) tomorrow\b|決算[：:].{0,30}(?:注目点|注目すべき点|何を期待|期待すべき|予想される)|決算.{0,40}(?:注目点|注目すべき点|期待すべきか|予想される内容)\s*$|が明日.{0,24}(?:決算|結果)を?発表|決算(?:報告)?プレビュー|^注目の決算[：:]/i, // earnings previews and "what to expect" teasers (owner, Oct 27)
  /\bCVE-\d{4}-\d{4,}\b|\bCVSS\s?\d/i, // vulnerability database entries, not company news (owner, Oct 27)
  /\bweekend trading\b|\bin (?:after|pre)-?(?:hours|market) trading\b.{0,20}\b(?:euros?|yen|pounds?)\b|\btrades? (?:at|for) [\d.,]+ (?:euros?|yen|pounds?)\b|週末取引|[\d.,]+\s?(?:ユーロ|ポンド)で取引/i, // price quotes in a foreign currency while the U.S. market is shut (owner, Oct 26)
];
/** A press-release label glued onto the headline ("2026年10月25日｜… ｜NYSE:BE｜プレスリリース") is not part of it (owner, Oct 26). */
export function cleanTitle(title: string) {
  return title.replace(/\s*[(（]\s*(?:NYSE|NASDAQ|Nasdaq(?:GS|GM|CM)?|AMEX|NYSEARCA|NYSEAMERICAN|NYSEAM|NYSEMKT|OTC(?:QX|QB)?)\s*[:：]\s*[A-Z.]{1,6}\s*[)）]/g, "").replace(/^\s*(?:20\d\d年\d{1,2}月\d{1,2}日|[A-Z][a-z]{2,8}\.? \d{1,2}, 20\d\d)\s*[|｜]\s*/, "")
    .replace(/\s*[|｜]\s*(?:NYSE|NASDAQ|Nasdaq(?:GS|GM|CM)?|AMEX)\s*[:：]\s*[A-Z.]{1,6}\s*(?:[|｜]\s*(?:プレスリリース|Press Release))?\s*$/, "")
    .replace(/\s*[|｜]\s*(?:プレスリリース|Press Release)\s*$/, "").replace(/\s*[：:]\s*(?:レポート|報道|report)\s*$/i, "").trim();
}
export const isNotNews = (text: string) => NOT_NEWS.some(pattern => pattern.test(text));

/** "X reports third-quarter results" read days after the release is an old story (owner, Oct 26: ASML, 12 days late).
 * Only a headline that announces results is judged, and only against a release date we know for that company. */
const RESULTS_HEADLINE = /\b(?:reports?|announces?|posts?|releases?|delivers?|publishes?)\b.{0,50}\b(?:Q[1-4]|first|second|third|fourth|quarter\w*|fiscal)\b.{0,40}\b(?:results?|earnings)\b|決算(?:を)?発表|決算発表/i;
const STALE_AFTER_MS = 3 * 24 * 3_600_000;
const releaseTimes = new Map<string, number[]>();
for (const event of calendarEvents) if (event.kind === "earnings" && event.ticker) releaseTimes.set(event.ticker, [...(releaseTimes.get(event.ticker) ?? []), Date.parse(event.startsAt)]);
for (const event of dateOnlyEarnings) if (event.ticker) releaseTimes.set(event.ticker, [...(releaseTimes.get(event.ticker) ?? []), Date.parse(`${event.date}T00:00:00Z`)]);
export function staleResults(ticker: string, title: string, publishedAt: string) {
  if (!RESULTS_HEADLINE.test(title)) return false;
  const at = Date.parse(publishedAt);
  const before = (releaseTimes.get(ticker) ?? []).filter(time => time <= at);
  // A release at most three days old, or one we have no date for, is kept.
  return before.length > 0 && at - Math.max(...before) > STALE_AFTER_MS;
}

const STOPWORDS = new Set("the and for with from that this its are was has have will into over after than more new how why what stock stocks shares share inc corp says say said amid about could would just now out up down".split(" "));
const words = (title: string) => new Set((title.toLowerCase().match(/[a-z0-9$.]+/g) ?? []).filter(word => word.length > 2 && !STOPWORDS.has(word)));
const normalized = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const SAME_STORY = 0.5, WINDOW_MS = 24 * 3_600_000;
function similar(a: Set<string>, b: Set<string>) {
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared) >= SAME_STORY;
}

export function wireStories(wire: Record<string, CompanyWireItem[]>, lang: Language, watched?: ReadonlySet<string>): WireStory[] {
  const ja = lang === "ja";
  const items = Object.entries(wire).flatMap(([ticker, list]) => watched && !watched.has(ticker) ? [] : list.flatMap(item => {
    const title = ja ? (item.titleJa && tidyJapanese(cleanTitle(item.titleJa))) : cleanTitle(item.titleEn);
    return title && !isNotNews(item.titleEn) && !isNotNews(title) && !staleResults(ticker, item.titleEn, item.publishedAt) && !staleResults(ticker, title, item.publishedAt) ? [{ ticker, item, title }] : [];
  })).sort((a, b) => Date.parse(a.item.publishedAt) - Date.parse(b.item.publishedAt));
  type Cluster = { key: string; words: Set<string>; first: number; tickers: string[]; best: (typeof items)[number] };
  const clusters: Cluster[] = [];
  for (const entry of items) {
    const at = Date.parse(entry.item.publishedAt), key = normalized(entry.title), tokens = words(entry.item.titleEn);
    const cluster = clusters.find(c => at - c.first <= WINDOW_MS && (c.key === key || similar(c.words, tokens)));
    if (!cluster) { clusters.push({ key, words: tokens, first: at, tickers: [entry.ticker], best: entry }); continue; }
    if (!cluster.tickers.includes(entry.ticker)) cluster.tickers.push(entry.ticker);
    // The company's own wire text wins over a third party's rewording of it.
    if (entry.item.origin === "wire" && cluster.best.item.origin !== "wire") cluster.best = entry;
  }
  return clusters.map(({ tickers, best, first }) => ({
    id: best.item.id, tickers: [...tickers].sort(), title: best.title, url: best.item.url, publisher: best.item.publisher,
    origin: best.item.origin, at: new Date(first).toISOString(),
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
