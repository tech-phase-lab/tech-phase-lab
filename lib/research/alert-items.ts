import type { GeneralNewsFeed } from "./general-news.ts";
import { informativeOfficial } from "./news-presentation.ts";
import { officialHeadlineJa } from "./official-news-ja.ts";
import { officialTime } from "./news-time.ts";

export type AlertItem = { id: string; title: string; at: number };

/** Articles the 速報 page lists, with the publication instant used for "new".
 * Only listed stories count: not uninformative headlines, not stories still
 * waiting for a Japanese translation, and not items that only have a fetch
 * time (a re-acquired old article is not news). */
export function alertItems(feed: Partial<GeneralNewsFeed> | null | undefined, now = Date.now()): AlertItem[] {
  if (!feed || typeof feed !== "object") return [];
  const result: AlertItem[] = [];
  const add = (id: unknown, title: unknown, at: string | undefined) => {
    const time = Date.parse(String(at ?? ""));
    if (typeof id === "string" && Number.isFinite(time) && time <= now + 60_000) result.push({ id, title: String(title ?? ""), at: time });
  };
  for (const item of Array.isArray(feed.officialUpdates) ? feed.officialUpdates : []) {
    try {
      if (!informativeOfficial(item)) continue;
      const translated = !!(officialHeadlineJa(item.url) ?? item.translationJa) || !!item.brief;
      const time = officialTime(item);
      if (!translated || time.kind === "observed") continue;
      add(`official:${item.id}`, officialHeadlineJa(item.url) ?? item.translationJa ?? item.title, time.at);
    } catch { /* A malformed row cannot raise the dot. */ }
  }
  for (const item of Array.isArray(feed.marketUpdates) ? feed.marketUpdates : []) add(`market:${item.id}`, item.titleJa, item.publishedAt);
  return result.sort((a, b) => b.at - a.at);
}
