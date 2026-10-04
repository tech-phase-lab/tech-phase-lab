import { NEWS_BRIEF_TITLE_SUFFIXES, type GeneralNewsFeed, type OfficialUpdate } from "./general-news.ts";
import type { Language } from "./data";
import { marketNewsBody, marketNewsDisplay } from "./market-news-display.ts";
import { officialPulseHeadlineJa } from "./official-news-ja.ts";
import { officialNewsDisplay } from "./news-presentation.ts";
import { officialTime } from "./news-time.ts";
import { analystNewsDisplay } from "./analyst-news.ts";

/** Reuse a complete approved fact for category-only reported-news headlines.
 * Paragraph boundaries are evidence-unit boundaries in these publications. Never
 * split on punctuation (J.P. Morgan, U.S., decimals), cut a fact to fit, or promote
 * a partial brief's pending details. Long units fall back to the approved title. */
function reportedNewsSummary(item: OfficialUpdate, lang: Language) {
  // The public feed deliberately drops the internal generalSource marker for
  // complete stories. Restrict this fallback to that publisher's exact generated
  // category titles, rather than taking a sentence from arbitrary article prose.
  if (item.brief || item.publisher !== "Reported company news"
    || !/^[A-Z][A-Z0-9.-]*: (?:Reported (?:share buyback|buyback recap|contract or partnership|acquisition|product or service news|capacity news|company development)|Management business outlook|Broker views on the business|Broker business and industry outlook)$/.test(item.title)) return undefined;
  const body = lang === "ja" ? item.bodyJa : item.bodyEn;
  const paragraph = body?.split(/\n\s*\n/, 1)[0].trim();
  return paragraph && Array.from(paragraph).length <= 180 && !/[\r\n]/.test(paragraph)
    ? paragraph : undefined;
}

/** Use the published feed shared with the home news list, including market updates. */
export function newsPulseItems(feed: GeneralNewsFeed | undefined, lang: Language) {
  const ja = lang === "ja";
  return [
    ...(feed?.officialUpdates ?? []).map(item => {
      const display = officialNewsDisplay(item, lang);
      const compactTitle = ja ? officialPulseHeadlineJa(item.url) ?? item.shortTitleJa : item.shortTitleEn;
      const suffix = NEWS_BRIEF_TITLE_SUFFIXES[lang];
      return { id: `official-${item.id}`, ticker: display.label, title: display.title, body: display.body ? `${display.title}\n\n${display.body}` : display.title,
        shortTitle: item.brief && compactTitle?.endsWith(suffix) ? compactTitle.slice(0, -suffix.length) : compactTitle,
        summary: compactTitle ? undefined : reportedNewsSummary(item, lang),
        url: item.url, ...officialTime(item) };
    }),
    ...(feed?.marketUpdates ?? []).map(item => {
      const display = marketNewsDisplay(item, lang);
      return { id: `market-${item.id}`, ticker: display.label, title: display.title, body: marketNewsBody(item, lang) ?? display.title, shortTitle: display.title !== (ja ? item.titleJa : item.titleEn) ? display.title : ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const };
    }),
    ...(feed?.analystUpdates ?? []).map(item => {
      const display = analystNewsDisplay(item, lang);
      return { id: `analyst-${item.id}`, ticker: display.label, title: display.title,
        body: display.body ? `${display.title}\n\n${display.body}` : display.title,
        shortTitle: display.title, at: item.publishedAt, kind: "published" as const };
    }),
    ...(feed?.items ?? []).map(item => ({ id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, body: ja ? item.summaryJa : item.summaryEn, shortTitle: ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const })),
  ].map(item => ({ ...item, shortTitle: item.shortTitle ?? item.title, summary: ("summary" in item ? item.summary : undefined) ?? item.shortTitle ?? item.title })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
}
