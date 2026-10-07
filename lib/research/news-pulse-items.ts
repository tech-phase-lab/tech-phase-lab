import { NEWS_BRIEF_TITLE_SUFFIXES, type GeneralNewsFeed } from "./general-news.ts";
import type { Language } from "./data";
import { marketNewsBody, marketNewsDisplay } from "./market-news-display.ts";
import { officialPulseHeadlineJa } from "./official-news-ja.ts";
import { informativeOfficial, officialNewsDisplay } from "./news-presentation.ts";
import { officialTime } from "./news-time.ts";
import { officialPulseHeadlines, marketPulseHeadlines, generalPulseHeadlines } from "./news-pulse-headline.ts";

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;

/** Use the published feed shared with the home news list, including market updates. */
export function newsPulseItems(feed: GeneralNewsFeed | undefined, lang: Language) {
  const ja = lang === "ja";
  return [
    ...(feed?.officialUpdates ?? []).filter(informativeOfficial).map(item => {
      const display = officialNewsDisplay(item, lang);
      const compactTitle = ja ? officialPulseHeadlineJa(item.url) ?? item.pulseTitleJa ?? item.shortTitleJa : item.pulseTitleEn ?? item.shortTitleEn;
      const suffix = NEWS_BRIEF_TITLE_SUFFIXES[lang];
      const shortTitle = item.brief && compactTitle?.endsWith(suffix) ? compactTitle.slice(0, -suffix.length) : compactTitle;
      return { id: `official-${item.id}`, ticker: display.label, title: display.title, body: display.body ? `${display.title}\n\n${display.body}` : display.title,
        shortTitle, headlines: officialPulseHeadlines(item, lang, display.title, shortTitle),
        url: item.url, ...officialTime(item), observedAt: item.observedAt as string | undefined };
    }),
    ...(feed?.marketUpdates ?? []).map(item => {
      const display = marketNewsDisplay(item, lang);
      return { headlines: marketPulseHeadlines(item, lang, display.title, ja ? item.pulseTitleJa ?? item.shortTitleJa : item.pulseTitleEn ?? item.shortTitleEn), id: `market-${item.id}`, ticker: display.label, title: display.title, body: marketNewsBody(item, lang) ?? display.title, shortTitle: display.title !== (ja ? item.titleJa : item.titleEn) ? display.title : ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const };
    }),
    // Analyst ratings and price targets stay out of the strip: a one-line
    // "upgrade" without the old and new target says nothing (owner, Oct 7).
    // Test publications that carry a checked bilingual summary.
    ...(feed?.originalPreviewItems ?? []).flatMap(item => "summary" in item && item.summary ? [{
      id: `preview-${item.id}`, ticker: item.sourceName, title: ja ? item.summary.titleJa : item.summary.titleEn,
      headlines: [...new Set([ja ? item.pulseTitleJa : item.pulseTitleEn, ja ? item.summary.titleJa : item.summary.titleEn]
        .filter((value): value is string => !!value))],
      body: ja ? item.summary.bodyJa : item.summary.bodyEn, shortTitle: ja ? item.pulseTitleJa : item.pulseTitleEn,
      url: item.sourceUrl, at: item.sourcePublishedAt ?? item.previewPublishedAt, kind: "published" as const }] : []),
    ...(feed?.items ?? []).map(item => ({ headlines: generalPulseHeadlines(item.tickers, lang, ja ? item.summaryJa : item.title, ja ? item.pulseTitleJa ?? item.shortTitleJa : item.pulseTitleEn ?? item.shortTitleEn), id: item.id, ticker: item.tickers.join(" · "), title: ja ? item.summaryJa : item.title, body: ja ? item.summaryJa : item.summaryEn, shortTitle: ja ? item.shortTitleJa : item.shortTitleEn, url: item.url, at: item.publishedAt, kind: "published" as const })),
  ].map(item => ({ ...item, shortTitle: item.shortTitle ?? item.title, summary: item.headlines[0] }))
    // The strip is a one-line Japanese summary; an item still awaiting its
    // reviewed translation stays in the news list below (in its original) only.
    .filter(item => !ja || JAPANESE.test(item.title))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
}
