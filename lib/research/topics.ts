import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import type { GeneralNewsFeed, GeneralNewsItem } from "./general-news.ts";
import { homeStockStories } from "./home-stock-news.ts";
import { tickerLabel } from "./wire-stories.ts";

/** プラス / マイナス / 中立 (owner, Nov 15): mixed, neutral and uncertain all read as 中立. */
export type TopicImpact = "positive" | "negative" | "neutral";
export type TopicCard = { id: string; tickers: string; impact: TopicImpact; at: string; title: string; summary?: string; publisher: string; url: string };

const JAPANESE = /[぀-ヿ㐀-鿿]/;

export function topicImpact(impact: TopicImpact, ja: boolean) {
  if (impact === "positive") return ja ? "▲ プラス" : "▲ Positive";
  if (impact === "negative") return ja ? "▼ マイナス" : "▼ Negative";
  return ja ? "● 中立" : "● Neutral";
}

/** A reviewed article's impactLabel comes first; a story without one uses the Stock News API's sentiment; anything else is 中立. */
export function impactOf(label?: GeneralNewsItem["impactLabel"], sentiment?: CompanyWireItem["sentiment"]): TopicImpact {
  const value = label ?? sentiment;
  return value === "positive" || value === "negative" ? value : "neutral";
}

const tickersOf = (tickers: readonly string[], ja: boolean) => tickers.map(ticker => tickerLabel(ticker, ja)).join(" · ");

/** The 注目トピック page's cards, newest first: the reviewed Stock News API articles (with their checked summaries) and the
 * Stock News API stories of the company headline feed. The same article (same link) appears once, the reviewed one winning.
 * The Japanese page shows Japanese headlines only; nothing is shown without a publisher and an article link. */
export function topicCards(data: GeneralNewsFeed | null, wire: Record<string, CompanyWireItem[]>, lang: Language): TopicCard[] {
  const ja = lang === "ja";
  const cards: TopicCard[] = [];
  const seen = new Set<string>();
  for (const item of data?.enabled ? data.items : []) {
    const title = ja ? item.shortTitleJa ?? item.summaryJa : item.shortTitleEn ?? item.title;
    const summary = ja ? item.summaryJa : item.summaryEn;
    if (!title?.trim() || (ja && !JAPANESE.test(title)) || !item.url || !item.publisher.trim() || seen.has(item.url)) continue;
    seen.add(item.url);
    cards.push({ id: `news-${item.id}`, tickers: tickersOf(item.tickers, ja), impact: impactOf(item.impactLabel), at: item.publishedAt, title,
      ...(summary && summary !== title ? { summary } : {}), publisher: item.publisher.trim(), url: item.url });
  }
  for (const story of homeStockStories(wire, lang)) {
    if (!story.url || !story.publisher.trim() || seen.has(story.url)) continue;
    seen.add(story.url);
    cards.push({ id: `wire-${story.id}`, tickers: tickersOf(story.tickers, ja), impact: impactOf(undefined, story.sentiment), at: story.at, title: story.title,
      publisher: story.publisher.trim(), url: story.url });
  }
  return cards.filter(card => Number.isFinite(Date.parse(card.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
