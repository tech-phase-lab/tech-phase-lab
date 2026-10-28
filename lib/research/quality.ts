export type Metric = {
  name: string;
  value: number;
  unit: "million" | "percent" | "per-share" | "GW";
  currency: "USD" | null;
  basis: "GAAP" | "non-GAAP" | "operating";
  scope: string;
  period: string;
  periodEnd: string;
  duration: "quarter" | "annual" | "point-in-time";
  kind: "actual" | "guidance" | "run-rate";
  sourceId: string;
};

export type Comparison =
  | { ok: true; value: number; unit: "%" | "pp" }
  | { ok: false; reason: "incompatible" | "invalid" | "non-positive-base" };

// Deliberately abstain instead of comparing unlike financial concepts.
export function compareMetrics(current: Metric, previous: Metric): Comparison {
  if (![current.value, previous.value].every(Number.isFinite)) return { ok: false, reason: "invalid" };
  const dimensions = ["name", "unit", "currency", "basis", "scope", "duration", "kind"] as const;
  if (dimensions.some((key) => current[key] !== previous[key]) || current.period === previous.period ||
      !Number.isFinite(Date.parse(current.periodEnd)) || !Number.isFinite(Date.parse(previous.periodEnd)) ||
      Date.parse(current.periodEnd) <= Date.parse(previous.periodEnd)) {
    return { ok: false, reason: "incompatible" };
  }
  if (current.unit === "percent") return { ok: true, value: current.value - previous.value, unit: "pp" };
  if (previous.value <= 0) return { ok: false, reason: "non-positive-base" };
  return { ok: true, value: (current.value / previous.value - 1) * 100, unit: "%" };
}

export type Source = { id: string; url: string; title: string; publisher: string; publishedOn: string; location: string };
export type EvidenceItem = { sourceIds: string[] };
export type EvidenceRecord = {
  publishedOn: string;
  reviewedOn: string;
  facts: EvidenceItem[];
  sources: Source[];
  metrics: Metric[];
};

export function evidenceIssues(record: EvidenceRecord): string[] {
  const issues: string[] = [];
  const ids = new Set(record.sources.map((source) => source.id));
  if (!ids.size) issues.push("missing-source");
  if (ids.size !== record.sources.length) issues.push("duplicate-source-id");
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date).toISOString().slice(0, 10) === date;
  const dates = [record.publishedOn, record.reviewedOn, ...record.sources.map((source) => source.publishedOn)];
  for (const date of dates) {
    try { if (!validDate(date)) issues.push("invalid-date"); } catch { issues.push("invalid-date"); }
  }
  if (record.reviewedOn < record.publishedOn) issues.push("review-before-publication");
  for (const source of record.sources) {
    try { if (new URL(source.url).protocol !== "https:") issues.push("unsafe-source-url"); }
    catch { issues.push("invalid-source-url"); }
  }
  if (!record.facts.length) issues.push("missing-facts");
  for (const fact of record.facts) {
    if (!fact.sourceIds.length || fact.sourceIds.some((id) => !ids.has(id))) issues.push("unsupported-fact");
  }
  for (const metric of record.metrics) {
    if (!Number.isFinite(metric.value)) issues.push("invalid-number");
    if (!ids.has(metric.sourceId)) issues.push("unsupported-metric");
    if (!metric.period || !metric.scope) issues.push("missing-metric-context");
  }
  return [...new Set(issues)];
}
