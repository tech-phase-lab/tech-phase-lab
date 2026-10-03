import type { GeneralNewsFeed } from "./general-news";
import type { Language } from "./data";
import { marketNewsBody, marketNewsDisplay } from "./market-news-display.ts";
import { officialPulseHeadlineJa } from "./official-news-ja.ts";
import { officialNewsDisplay } from "./news-presentation.ts";
import { officialTime } from "./news-time.ts";

/** Use the published feed shared with the home news list, including market updates. */
export function newsPulseItems(feed: GeneralNewsFeed | undefined, lang: Language) {
  const ja = lang === "ja";
  return [
    ...(feed?.officialUpdates ?? []).map(item => {
      const display = officialNewsDisplay(item, lang);
      return { id: `official-${item.id}`, ticker: display.label, title: display.title, body: display.body ? `${display.title}\n\n${display.body}` : display.title,
        shortTitle: ja ? officialPulseHeadlineJa(item.url) ?? item.shortTitleJa : item.shortTitleEn,
        url: item.url, ...officialTime(item) };
    }),
    ...(feed?.marketUpdates ?? []).map(item => {
      const display = marketNewsDisplay(item, lang);
      return { id: `market-${item.id}`, ticker: display.label, title: display.title, body: marketNewsBody(item, lang) ?? display.title, shortTitle: display.title !== (ja ? item.titleJa : item.titleEn) ? display.title : ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const };
    }),
    ...(feed?.items ?? []).map(item => ({ id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, body: ja ? item.summaryJa : item.summaryEn, shortTitle: ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const })),
  ].map(item => ({ ...item, shortTitle: item.shortTitle ?? item.title })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
}
