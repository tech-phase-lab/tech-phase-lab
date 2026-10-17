import type { GeneralNewsFeed } from "./general-news.ts";
import type { CompanyWireItem } from "./company-wire.ts";
import { flashAlerts } from "./flash-rows.ts";

export type AlertItem = { id: string; title: string; at: number };

/** Rows the 速報 page lists, with the publication instant used for "new".
 * The page and the NEW dot read the same rows (flash-rows), so they agree:
 * only listed stories count, none without a stated source time, none
 * waiting for a Japanese translation, and nothing published more than three
 * days ago (owner, Oct 8 and Oct 14). */
export function alertItems(feed: Partial<GeneralNewsFeed> | null | undefined, wire: Record<string, CompanyWireItem[]> = {}, now = Date.now()): AlertItem[] {
  if (!feed || typeof feed !== "object") return [];
  return flashAlerts(feed, wire, now).sort((a, b) => b.at - a.at);
}
