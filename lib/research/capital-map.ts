export type CapitalHolding = {
  securityId: string;
  ticker: string;
  name: string;
  shareClass?: string;
  instrument: "stock" | "put" | "call";
  shares: number;
  value: number;
  // Issuer-published ETF weight; never renormalize after excluding cash.
  reportedWeight?: number;
  // Set only after verifying denominator date, share class and ADR ratio.
  outstandingShares?: number | null;
};
export type CapitalSnapshot = {
  id: string;
  asOf: string;
  publishedOn: string;
  complete: boolean;
  source?: { type?: "13f" | "issuer"; url: string; coverUrl: string; accession: string; checkedOn: string; entryCount: number; totalValue: number; sha256: string };
  holdings: CapitalHolding[];
};
export type CapitalPortfolio = {
  id: string;
  kind: "manager" | "etf" | "corporate";
  name: string;
  subtitle: string;
  current: CapitalSnapshot;
  previous?: CapitalSnapshot;
};
export type CapitalChange = "new" | "increased" | "reduced" | "unchanged" | "exited" | "unknown";
export type CapitalRow = CapitalHolding & {
  weight: number;
  change: CapitalChange;
  shareChangePercent: number | null;
  companyPercent: number | null;
};
const key = (row: CapitalHolding) => `${row.securityId}:${row.instrument}`;

export function capitalRows(current: CapitalSnapshot, previous?: CapitalSnapshot): CapitalRow[] {
  const total = current.holdings.reduce((sum, row) => sum + row.value, 0);
  const earlier = new Map(previous?.holdings.map(row => [key(row), row]) ?? []);
  const seen = new Set(current.holdings.map(key));
  const rows: CapitalRow[] = current.holdings.map(row => {
    const old = earlier.get(key(row));
    const change: CapitalChange = !previous ? "unknown" : !old ? previous.complete ? "new" : "unknown"
      : row.shares > old.shares ? "increased" : row.shares < old.shares ? "reduced" : "unchanged";
    return { ...row, weight: row.reportedWeight ?? (total > 0 ? row.value / total * 100 : 0), change,
      shareChangePercent: old && old.shares > 0 ? (row.shares - old.shares) / old.shares * 100 : null,
      companyPercent: row.instrument === "stock" && row.outstandingShares && row.outstandingShares > 0
        ? row.shares / row.outstandingShares * 100 : null };
  });
  // A missing position only means an exit in a complete new disclosure.
  if (previous && current.complete) for (const old of previous.holdings) if (!seen.has(key(old))) {
    rows.push({ ...old, shares: 0, value: 0, weight: 0, change: "exited",
      shareChangePercent: old.shares > 0 ? -100 : null, companyPercent: null });
  }
  return rows.toSorted((a, b) => b.weight - a.weight);
}

export function etfOverlap(a: CapitalSnapshot, b: CapitalSnapshot) {
  const left = capitalRows(a).filter(row => row.instrument === "stock");
  const right = new Map(capitalRows(b).filter(row => row.instrument === "stock").map(row => [row.securityId, row]));
  const shared = left.flatMap(row => {
    const other = right.get(row.securityId);
    return other ? [{ ticker: row.ticker, name: row.name, left: row.weight, right: other.weight,
      shared: Math.min(row.weight, other.weight) }] : [];
  }).toSorted((a, b) => b.shared - a.shared);
  return { rows: shared, percent: shared.reduce((sum, row) => sum + row.shared, 0) };
}

export function parseCapitalPreferences(raw: string | null, allowedIds: readonly string[]) {
  const empty = { saved: [] as string[], seen: {} as Record<string, string> };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return empty;
    const data = value as { saved?: unknown; seen?: unknown };
    const saved = Array.isArray(data.saved) ? [...new Set(data.saved.filter((id): id is string => typeof id === "string" && allowedIds.includes(id)))] : [];
    const seen: Record<string, string> = {};
    if (data.seen && typeof data.seen === "object") for (const [id, version] of Object.entries(data.seen)) {
      if (allowedIds.includes(id) && typeof version === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(version)) seen[id] = version;
    }
    return { saved, seen };
  } catch { return empty; }
}
