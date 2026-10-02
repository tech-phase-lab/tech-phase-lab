import type { GeneralNewsFeed } from "./general-news";
import type { Language } from "./data";
import { marketNewsDisplay } from "./market-news-display.ts";
import { officialHeadlineJa, officialPulseHeadlineJa } from "./official-news-ja.ts";
import { officialTime } from "./news-time.ts";

/** Use the published feed shared with the home news list, including market updates. */
export function newsPulseItems(feed: GeneralNewsFeed | undefined, lang: Language) {
  const ja = lang === "ja";
  return [
    ...(feed?.officialUpdates ?? []).map(item => ({ id: `official-${item.id}`, ticker: item.tickers.join(" · ") || item.publisher, title: ja ? officialHeadlineJa(item.url) ?? item.translationJa ?? "公式アップデート（日本語訳を準備中）" : item.title, url: item.url, ...officialTime(item) })),
    ...(feed?.marketUpdates ?? []).map(item => {
      const display = marketNewsDisplay(item, lang);
      return { id: `market-${item.id}`, ticker: display.label, title: display.title, url: item.url, at: item.publishedAt, kind: "published" as const };
    }),
    ...(feed?.items ?? []).map(item => ({ id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, url: item.url, at: item.publishedAt, kind: "published" as const })),
  ].map(item => ({ ...item, shortTitle: ja ? officialPulseHeadlineJa(item.url) ?? item.title : item.title })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
}
