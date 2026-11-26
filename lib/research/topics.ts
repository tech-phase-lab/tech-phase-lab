import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import type { GeneralNewsFeed, GeneralNewsItem } from "./general-news.ts";
import { stockNewsWire } from "./home-stock-news.ts";
import { topicNoise } from "./topic-noise.ts";
import { cleanTitle, lawFirmSolicitation, otcName, otcTicker, primaryTickers, similarStory, STORY_WINDOW_MS, storyCandidates, storyKey, storyWords, tickerLabel } from "./wire-stories.ts";

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

/** The line under the topics list (owner, Nov 15): the cards come from the Stock News API. */
export const topicCredit = (ja: boolean) => ja ? "提供：Stock News API" : "Source: Stock News API";

/** The summary is behind 「＋」 (owner, Nov 26): a card shows its headline only, and 「＋」 opens the summary under it (「−」 closes it).
 * A card without a summary has no 「＋」. The Japanese summary is at most SUMMARY_JA_MAX characters (the 80 to 100 characters agreed on
 * Nov 16), in whole sentences: a longer one keeps its leading sentences that fit, and one whose first sentence alone is too long is not
 * shown. */
export const SUMMARY_JA_MAX = 100;
export function fitSummary(summary: string, ja: boolean): string | undefined {
  const text = summary.trim();
  if (!text) return undefined;
  if (!ja || text.length <= SUMMARY_JA_MAX) return text;
  let kept = "";
  for (const sentence of text.match(/[^。！？]+[。！？]+[」』）)]*/g) ?? []) {
    if ((kept + sentence).length > SUMMARY_JA_MAX) break;
    kept += sentence;
  }
  return kept.trim() || undefined;
}
export const summaryToggle = (open: boolean, ja: boolean) => ({ text: open ? "−" : "＋",
  label: open ? (ja ? "要約を閉じる" : "Show less") : (ja ? "要約をすべて表示" : "Show the full summary") });

/** How reputable a publisher is, lower first (owner, Nov 15: of the same story from several publishers, the most reputable one's card
 * is kept). The international wire services and financial papers, then the company's own release, then the other national outlets,
 * then the technology and trade press, then everyone else. */
const PUBLISHER_TIERS = [
  /\breuters\b|\bbloomberg\b|associated press|^ap(?: news)?$|wall street journal|\bwsj\b|financial times/i,
  /business ?wire|pr ?newswire|globe ?news ?wire|access ?(?:news)?wire|newsfile/i,
  /\bcnbc\b|barron|market ?watch|new york times|\bcnn\b|fox business|business insider|guardian|sky ?news|nikkei|the information|new york post/i,
  /techcrunch|the verge|engadget|\bcnet\b|venturebeat|geekwire|fast company|digital trends|techxplore|pymnts|freightwaves|kitco|deadline|cheddar/i,
];
const PRESS_RELEASE_TIER = 1;
export function publisherRank(publisher: string) {
  const tier = PUBLISHER_TIERS.findIndex(pattern => pattern.test(publisher.trim()));
  return tier < 0 ? PUBLISHER_TIERS.length : tier;
}

// Words of an English headline for the same-story test: case, "$" and commas ignored, numbers kept whole, units and small words left
// out, other words cut to their first four letters so "fined" / "fines" and "Italy" / "Italian" count as the same word.
const SMALL = new Set("the and for with from that this its are was has have will into over after than more new how why what stock stocks shares share inc corp says say said amid about could would just now out up down by on in of to at as be is it".split(" "));
const UNITS = new Set("million billion trillion mln bln bn usd dollars dollar euros euro eur percent pct".split(" "));
function stems(title: string) {
  return new Set((title.normalize("NFKC").toLowerCase().replace(/[$€£¥,]/g, "").match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [])
    .filter(word => /\d/.test(word) ? word.length > 1 : word.length > 2 && !SMALL.has(word) && !UNITS.has(word))
    .map(word => /\d/.test(word) ? word : word.slice(0, 4)));
}
/** Owner, Nov 15 (Meta's fine in Italy shown twice): two English headlines about the same company tell the same story when at least
 * three of their words match and those cover 60% of the shorter headline. Owner, Nov 26 (IQM's order from QAI shown twice, as a
 * partnership and as an order): five or more matching words that cover half of the shorter headline also tell the same story. */
export function sameTopic(a: string, b: string) {
  const x = stems(a), y = stems(b);
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  const share = shared / Math.min(x.size, y.size);
  return (shared >= 3 && share >= 0.6) || (shared >= 5 && share >= 0.5);
}

type Entry = { card: TopicCard; tickers: string[]; titleEn: string; key: string; words: Set<string>; time: number; rank: number; reviewed: boolean };

function better(a: Entry, b: Entry) {
  return a.rank - b.rank || Number(b.reviewed) - Number(a.reviewed) || Number(!!b.card.summary) - Number(!!a.card.summary) || a.time - b.time;
}

function sameStory(a: Entry, b: Entry) {
  if (a.key === b.key || similarStory(a.words, b.words)) return true;
  const shared = a.tickers.length ? a.tickers.some(ticker => b.tickers.includes(ticker)) : !b.tickers.length;
  return shared && sameTopic(a.titleEn, b.titleEn);
}

const summaryOf = (summary: string | null | undefined, ja: boolean) => summary ? fitSummary(summary, ja) : undefined;

/** A card's companies: an OTC line is shown by the company's name when known and otherwise left out (owner, Nov 26), each name once. */
const tickersOf = (tickers: readonly string[], ja: boolean) =>
  [...new Set(primaryTickers(tickers).filter(ticker => !otcTicker(ticker) || otcName(ticker, ja)).map(ticker => tickerLabel(ticker, ja)))].join(" · ");

/** The 注目トピック page's cards, newest first: the reviewed Stock News API articles (with their checked summaries) and the
 * Stock News API stories of the company headline feed (with the article's own summary when one was given and, on the Japanese page,
 * checked). The same article (same link) appears once, the reviewed one winning; the same story from several publishers (within 24
 * hours: the same headline, half the words shared, or for the same company the rule of sameTopic) appears once, as the most reputable
 * publisher's card (publisherRank), listing every company it names. The Japanese page shows Japanese headlines only; nothing is shown
 * without a publisher and an article link. */
export function topicCards(data: GeneralNewsFeed | null, wire: Record<string, CompanyWireItem[]>, lang: Language): TopicCard[] {
  const ja = lang === "ja";
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const add = (card: TopicCard, tickers: string[], titleEn: string, reviewed: boolean) => {
    const time = Date.parse(card.at);
    if (!Number.isFinite(time)) return;
    entries.push({ card, tickers, titleEn, key: storyKey(card.title), words: storyWords(titleEn), time, rank: publisherRank(card.publisher), reviewed });
  };
  for (const item of data?.enabled ? data.items : []) {
    const title = ja ? item.shortTitleJa ?? item.summaryJa : item.shortTitleEn ?? item.title;
    const summary = summaryOf(ja ? item.summaryJa : item.summaryEn, ja);
    if (!title?.trim() || (ja && !JAPANESE.test(title)) || !item.url || !item.publisher.trim() || seen.has(item.url)
      // A law firm's shareholder solicitation is never a topic, from either feed (owner, Nov 15).
      || lawFirmSolicitation(item.title) || lawFirmSolicitation(title)) continue;
    seen.add(item.url);
    add({ id: `news-${item.id}`, tickers: "", impact: impactOf(item.impactLabel), at: item.publishedAt, title,
      ...(summary && summary !== title ? { summary } : {}), publisher: item.publisher.trim(), url: item.url }, [...item.tickers], item.title, true);
  }
  for (const { ticker, item, title } of storyCandidates(stockNewsWire(wire), lang)) {
    if ((ja && !JAPANESE.test(title)) || !item.url || !item.publisher.trim()) continue;
    const already = entries.find(entry => entry.card.url === item.url);
    if (already) { if (!already.tickers.includes(ticker)) already.tickers.push(ticker); continue; }
    const summary = summaryOf(ja ? item.summaryJa : item.summaryEn, ja);
    add({ id: `wire-${item.id}`, tickers: "", impact: impactOf(undefined, item.sentiment), at: item.publishedAt, title,
      ...(summary && summary !== title ? { summary } : {}), publisher: item.publisher.trim(), url: item.url }, [ticker], cleanTitle(item.titleEn), false);
  }
  // Owner, Nov 26: routine notices, talk and promotions are not topics (topicNoise), judged with every company an article is filed under.
  const kept = entries.filter(entry => !topicNoise(entry.titleEn, entry.card.publisher, entry.tickers));
  kept.sort((a, b) => a.time - b.time);
  const clusters: { first: number; members: Entry[] }[] = [];
  for (const entry of kept) {
    const cluster = clusters.find(c => entry.time - c.first <= STORY_WINDOW_MS && c.members.some(member => sameStory(member, entry)));
    if (cluster) cluster.members.push(entry);
    else clusters.push({ first: entry.time, members: [entry] });
  }
  return clusters.map(({ first, members }) => {
    const best = [...members].sort(better)[0];
    // A company's own press release is not market news (owner, Nov 26: Freedom Gold's offering showed 「市場」): its card drops the
    // market stream's MKT label.
    const tickers = [...new Set([best, ...members].flatMap(member => member.tickers))].sort()
      .filter(ticker => ticker !== "MKT" || publisherRank(best.card.publisher) !== PRESS_RELEASE_TIER);
    return { ...best.card, tickers: tickersOf(tickers, ja), at: members.length > 1 ? new Date(first).toISOString() : best.card.at };
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
