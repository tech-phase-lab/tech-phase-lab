import type { GeneralNewsFeed } from "./general-news.ts";
import type { Language } from "./data";
import type { CompanyWireItem } from "./company-wire.ts";
import { shownInLanguage } from "./news-presentation.ts";
import { lateDetection, officialTime } from "./news-time.ts";

/** A company has something new when an item was published within this window,
 * found promptly, and after the owner last opened that company's monitor. */
export const FRESH_WINDOW_MS = 3_600_000;
const SEEN_KEY = "tech-phase:company-seen:v1";

export function readSeen(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch { return {}; }
}
export function markSeen(ticker: string, now = Date.now()) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [ticker]: now })); window.dispatchEvent(new Event("tech-phase:company-seen")); } catch { /* Marks stay session-only. */ }
}

export function isFreshItem(at: string, kind: string, observedAt: string | undefined, seenAt: number, now: number) {
  const age = now - Date.parse(at);
  return kind === "published" && Number.isFinite(age) && age >= 0 && age < FRESH_WINDOW_MS
    && !lateDetection(at, observedAt) && Date.parse(at) > seenAt;
}

/** New-item count per ticker from the published feed and the wire headlines. */
export function freshByCompany(feed: GeneralNewsFeed | null, wire: Record<string, CompanyWireItem[]>, lang: Language, seen: Record<string, number>, now: number) {
  const counts = new Map<string, number>();
  const add = (ticker: string, at: string, kind: string, observedAt?: string) => {
    if (isFreshItem(at, kind, observedAt, seen[ticker] ?? 0, now)) counts.set(ticker, (counts.get(ticker) ?? 0) + 1);
  };
  for (const item of feed?.officialUpdates ?? []) {
    if (!shownInLanguage(item, lang)) continue;
    const time = officialTime(item);
    for (const ticker of item.tickers) add(ticker, time.at, time.kind, item.observedAt);
  }
  for (const item of feed?.analystUpdates ?? []) add(item.ticker, item.publishedAt, "published", item.observedAt);
  for (const item of feed?.items ?? []) for (const ticker of item.tickers) add(ticker, item.publishedAt, "published", item.observedAt);
  for (const [ticker, rows] of Object.entries(wire)) for (const row of rows) if (lang !== "ja" || row.titleJa) add(ticker, row.publishedAt, "published");
  return counts;
}
