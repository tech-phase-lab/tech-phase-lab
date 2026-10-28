import type { ResearchEvent } from "./data";

/** Only compare recognized fiscal periods, never guess from the ticker/date. */
export function normalizedEarningsPeriod(value: string): string | null {
  const normalized = value.toUpperCase().replace(/\s+/g, " ").trim();
  const periods = new Set<string>();
  for (const quarter of normalized.matchAll(/\b(?:FQ|Q)([1-4])(?:\s*(?:FY)?\s*(20\d{2}))?\b/g)) {
    const before = /(?:FY)?\s*(20\d{2})\s*$/.exec(normalized.slice(0, quarter.index));
    if (quarter[2] && before?.[1] && quarter[2] !== before[1]) return null;
    const year = quarter[2] || before?.[1];
    periods.add(`Q${quarter[1]}${year ? ` ${year}` : ""}`);
  }
  const ordinals: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4 };
  for (const quarter of normalized.matchAll(/\b(FIRST|SECOND|THIRD|FOURTH)[ -]+QUARTER\b/g)) {
    const tail = normalized.slice(quarter.index + quarter[0].length);
    const after = /^\s+(?:(?:OF\s+)?FISCAL(?:\s+YEAR)?\s+|FY\s*)?(20\d{2})\b/.exec(tail)
      ?? /^\s+(?:AND|&)\s+(?:FULL[ -]+(?:FISCAL[ -]+)?YEAR|FISCAL[ -]+YEAR)\s+(20\d{2})\b/.exec(tail);
    const before = /(?:\bFY\s*|\b)(20\d{2})\s+(?:FISCAL\s+)?$/.exec(normalized.slice(0, quarter.index));
    if (after?.[1] && before?.[1] && after[1] !== before[1]) return null;
    const year = after?.[1] || before?.[1];
    // Only the explicit fiscal-period phrase supplies a year. A publication
    // date later in a title must not turn a yearless quarter into an identity.
    if (!year) return null;
    periods.add(`Q${ordinals[quarter[1]]} ${year}`);
  }
  // Combined quarter/full-year release titles identify the quarter. Multiple
  // distinct reported quarters/years remain separate rather than guessing.
  if (periods.size) return periods.size === 1 ? [...periods][0] : null;
  const annual = /\bFY\s*(20\d{2})\b/.exec(normalized);
  return annual ? `FY ${annual[1]}` : null;
}

function eventPeriod(event: ResearchEvent): string | null {
  if (event.earningsPeriod) return normalizedEarningsPeriod(event.earningsPeriod);
  const periods = [...new Set(event.metrics.filter(metric => metric.kind === "actual")
    .map(metric => normalizedEarningsPeriod(metric.period)).filter(Boolean))];
  if (periods.length === 1) return periods[0];
  // Source titles describe the release; summaries can also mention guidance for
  // the next quarter, so do not infer identity from arbitrary article prose.
  return normalizedEarningsPeriod(event.sources[0]?.title ?? "");
}

function sameRelease(first: ResearchEvent, next: ResearchEvent): boolean {
  if (first.kind !== "earnings" || next.kind !== "earnings" || first.ticker !== next.ticker
      || first.publishedOn !== next.publishedOn) return false;
  const revised = (event: ResearchEvent) => /\b(?:restated|restatement|revised|correction|corrected)\b|訂正|修正/.test(
    `${event.title.en.toLowerCase()} ${event.title.ja} ${event.sources[0]?.title.toLowerCase() ?? ""}`);
  if (revised(first) !== revised(next)) return false;
  const left = eventPeriod(first), right = eventPeriod(next);
  if (left && right) return left === right;
  // A shared release URL is positive evidence when either record lacks a
  // fiscal period. Two periodless same-day posts are not automatically equal.
  return first.sources.some(source => next.sources.some(other => other.url === source.url));
}

/** Keep priority copy/metrics, but retain every attributed source and fact. */
function mergeEvidence(first: ResearchEvent, next: ResearchEvent): ResearchEvent {
  const sources = first.sources.map(source => ({ ...source }));
  const aliases = new Map<string, string>();
  for (const source of next.sources) {
    const sameUrl = sources.find(existing => existing.url === source.url);
    if (sameUrl) { aliases.set(source.id, sameUrl.id); continue; }
    let id = source.id, suffix = 2;
    while (sources.some(existing => existing.id === id)) id = `${source.id}-${suffix++}`;
    aliases.set(source.id, id);
    sources.push({ ...source, id });
  }
  const facts = first.facts.map(fact => ({ ...fact, text: { ...fact.text }, sourceIds: [...fact.sourceIds] }));
  for (const fact of next.facts) {
    const sourceIds = fact.sourceIds.map(id => aliases.get(id) ?? id);
    const equal = facts.find(existing => existing.text.ja === fact.text.ja && existing.text.en === fact.text.en);
    if (equal) equal.sourceIds = [...new Set([...equal.sourceIds, ...sourceIds])];
    else facts.push({ ...fact, text: { ...fact.text }, sourceIds: [...new Set(sourceIds)] });
  }
  // Conflicting figures remain separate facts with their original source IDs.
  // Secondary figures never enter the primary metric/comparison strip.
  const period = eventPeriod(first) ?? eventPeriod(next);
  return { ...first, ...(period ? { earningsPeriod: period } : {}), sources, facts,
    reviewedOn: first.reviewedOn > next.reviewedOn ? first.reviewedOn : next.reviewedOn };
}

/** Callers provide issuer notes first, then flashes and curated fallbacks. */
export function deduplicateResearchEvents(events: ResearchEvent[]): ResearchEvent[] {
  const result: ResearchEvent[] = [];
  for (const event of events) {
    const index = result.findIndex(existing => sameRelease(existing, event));
    if (index < 0) result.push(event);
    else result[index] = mergeEvidence(result[index], event);
  }
  return result;
}
