import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import { wireStories, type WireStory } from "./wire-stories.ts";

/** Owner, Nov 15: the home's top band and its news list show the Stock News API stories (high-tech companies, and market news under
 * MKT), not the Tech Alerts (ハイテク速報) items. The monitor marks those rows with source "stocknews". */
export const STOCK_NEWS_SOURCE = "stocknews";

const JAPANESE = /[぀-ヿ㐀-鿿]/;

// The same feed object gives the same filtered object, so wireStories() keeps its per-feed answer.
const memo = new WeakMap<object, Record<string, CompanyWireItem[]>>();
/** Only the Stock News API rows of the company headline feed. */
export function stockNewsWire(wire: Record<string, CompanyWireItem[]>): Record<string, CompanyWireItem[]> {
  const cached = memo.get(wire);
  if (cached) return cached;
  const out: Record<string, CompanyWireItem[]> = {};
  for (const [ticker, list] of Object.entries(wire)) {
    const kept = list.filter(item => item.source === STOCK_NEWS_SOURCE);
    if (kept.length) out[ticker] = kept;
  }
  memo.set(wire, out);
  return out;
}

/** The Stock News API stories for the home list, newest first. The Japanese page lists Japanese headlines only. */
export function homeStockStories(wire: Record<string, CompanyWireItem[]>, lang: Language): WireStory[] {
  const stories = wireStories(stockNewsWire(wire), lang);
  return lang === "ja" ? stories.filter(story => JAPANESE.test(story.title)) : stories;
}
