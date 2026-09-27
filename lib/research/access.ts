import type { ResearchEvent } from "./data";
// The agreed evaluation sample remains public. New notes default to PRO analysis.
export function isPublicSample(id: string) { return id === "mu-q3-2026"; }
export function publicEvent(event: ResearchEvent): ResearchEvent {
  if (isPublicSample(event.id)) return { ...event, locked: false };
  // Explicit allowlist: new analysis fields must never leak through object spread.
  return {
    id: event.id, ticker: event.ticker, company: event.company, category: event.category,
    kind: event.kind, publishedOn: event.publishedOn, reviewedOn: event.reviewedOn,
    title: event.title, summary: event.summary, change: event.change, facts: event.facts,
    sources: event.sources, metrics: event.metrics, previous: event.previous,
    interpretation: { ja: "", en: "" }, unknown: { ja: "", en: "" }, next: { ja: "", en: "" }, locked: true,
  };
}
