import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import { tidyJapanese } from "./ja-text.ts";

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
];
export const isNotNews = (text: string) => NOT_NEWS.some(pattern => pattern.test(text));

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
    const title = ja ? (item.titleJa && tidyJapanese(item.titleJa)) : item.titleEn;
    return title && !isNotNews(item.titleEn) && !isNotNews(title) ? [{ ticker, item, title }] : [];
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
