import type { ResearchEvent } from "./data";

/**
 * Keep the highest-priority representation of a single earnings release.
 * Callers provide events in priority order: issuer-backed live notes first,
 * then secondary flashes and checked-in fallback content.
 *
 * Other announcement types are not collapsed because a company can publish
 * several distinct product, partnership, or acquisition updates on one day.
 */
export function deduplicateResearchEvents(events: ResearchEvent[]): ResearchEvent[] {
  const earnings = new Set<string>();
  return events.filter((event) => {
    if (event.kind !== "earnings") return true;
    const key = `${event.ticker}:${event.publishedOn}`;
    if (earnings.has(key)) return false;
    earnings.add(key);
    return true;
  });
}
