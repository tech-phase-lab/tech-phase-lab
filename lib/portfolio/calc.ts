/** US-stock portfolio arithmetic. Pure: no network, no storage. Money is kept as plain numbers; rounding happens only when shown. */
export type Holding = {
  ticker: string;
  name?: string;
  shares: number;
  /** Average acquisition price in US dollars (what the broker screen shows). */
  avgCostUsd: number;
  /** JPY per USD when it was bought, if the screen showed the yen cost too (cost in yen / cost in dollars). */
  avgCostFx?: number;
  /** The broker this lot was read from (or 手入力). One lot per broker and ticker. */
  source?: string;
  /** The day this lot was last checked against stock splits (YYYY-MM-DD). Splits after it are applied once, then this moves to today. */
  checkedAt?: string;
};
export type Quote = { ticker: string; close: number; asOf: string };
export type Breakdown = { source: string; shares: number };
export type Merged = Holding & { breakdown?: Breakdown[] };
export type Row = {
  breakdown?: Breakdown[];
  ticker: string; name?: string; shares: number; avgCostUsd: number; avgCostFx?: number;
  price: number | null; asOf: string | null;
  costUsd: number; valueUsd: number | null; gainUsd: number | null; gainPct: number | null;
  valueJpy: number | null; gainJpy: number | null;
};
export type Totals = {
  costUsd: number; valueUsd: number | null; gainUsd: number | null; gainPct: number | null;
  valueJpy: number | null; gainJpy: number | null;
  /** How many rows had no price yet; the totals are only given when every row has one. */
  missingPrices: number;
};

export function valueHoldings(holdings: readonly Merged[], quotes: Readonly<Record<string, Quote | undefined>>, usdJpy: number | null): { rows: Row[]; totals: Totals } {
  const rows: Row[] = holdings.map(h => {
    const quote = quotes[h.ticker];
    const costUsd = h.shares * h.avgCostUsd;
    const price = quote && Number.isFinite(quote.close) && quote.close > 0 ? quote.close : null;
    const valueUsd = price === null ? null : h.shares * price;
    const gainUsd = valueUsd === null ? null : valueUsd - costUsd;
    const valueJpy = valueUsd === null || usdJpy === null ? null : valueUsd * usdJpy;
    // Yen gain needs the rate at the time of purchase; without it the yen profit is not guessed.
    const gainJpy = valueJpy !== null && h.avgCostFx !== undefined ? valueJpy - costUsd * h.avgCostFx : null;
    return { breakdown: h.breakdown, ticker: h.ticker, name: h.name, shares: h.shares, avgCostUsd: h.avgCostUsd, avgCostFx: h.avgCostFx,
      price, asOf: quote?.asOf ?? null, costUsd, valueUsd, gainUsd, gainPct: gainUsd === null || costUsd <= 0 ? null : gainUsd / costUsd * 100, valueJpy, gainJpy };
  });
  const costUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const missingPrices = rows.filter(row => row.valueUsd === null).length;
  const complete = missingPrices === 0 && rows.length > 0;
  const valueUsd = complete ? rows.reduce((sum, row) => sum + row.valueUsd!, 0) : null;
  const gainUsd = valueUsd === null ? null : valueUsd - costUsd;
  const valueJpy = complete && usdJpy !== null ? valueUsd! * usdJpy : null;
  const gainJpy = complete && rows.every(row => row.gainJpy !== null) ? rows.reduce((sum, row) => sum + row.gainJpy!, 0) : null;
  return { rows, totals: { costUsd, valueUsd, gainUsd, gainPct: gainUsd === null || costUsd <= 0 ? null : gainUsd / costUsd * 100, valueJpy, gainJpy, missingPrices } };
}

/** Share of each position in the total value (percent), for the allocation bar. Rows without a price are left out. */
export function weights(rows: readonly Row[]): { ticker: string; percent: number }[] {
  const total = rows.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);
  if (total <= 0) return [];
  return rows.filter(row => row.valueUsd !== null).map(row => ({ ticker: row.ticker, percent: row.valueUsd! / total * 100 })).sort((a, b) => b.percent - a.percent);
}

/** One row per ticker for the list: shares add up, the average cost is weighted by shares. The yen rate is weighted by cost
 * so the yen cost stays exact; it is only given when every lot has one. The breakdown is given only when 2 or more brokers hold it. */
export function aggregate(lots: readonly Holding[]): Merged[] {
  const groups = new Map<string, Holding[]>();
  for (const lot of lots) groups.set(lot.ticker, [...(groups.get(lot.ticker) ?? []), lot]);
  return [...groups.values()].map(group => {
    const shares = group.reduce((sum, lot) => sum + lot.shares, 0);
    const cost = group.reduce((sum, lot) => sum + lot.shares * lot.avgCostUsd, 0);
    const fxKnown = group.every(lot => lot.avgCostFx !== undefined);
    const fx = fxKnown ? group.reduce((sum, lot) => sum + lot.shares * lot.avgCostUsd * lot.avgCostFx!, 0) / cost : undefined;
    const name = group.find(lot => lot.name)?.name;
    const sources = group.map(lot => ({ source: lot.source ?? "その他", shares: lot.shares }));
    return { ticker: group[0].ticker, ...(name ? { name } : {}), shares, avgCostUsd: cost / shares, ...(fx !== undefined ? { avgCostFx: fx } : {}), ...(sources.length > 1 ? { breakdown: sources } : {}) };
  });
}

/** Reading a broker again replaces that broker's lots only; every other broker is left alone. */
export function replaceSource(existing: readonly Holding[], source: string, incoming: readonly Holding[]): Holding[] {
  return [...existing.filter(lot => (lot.source ?? "その他") !== source), ...incoming.map(lot => ({ ...lot, source }))];
}

export type Status = "new" | "update" | "same";
/** How a row read from a broker compares with what is already saved for that broker. */
export function statusOf(existing: readonly Holding[], source: string, row: Holding): Status {
  const saved = existing.find(lot => (lot.source ?? "その他") === source && lot.ticker === row.ticker);
  if (!saved) return "new";
  const close = (a: number | undefined, b: number | undefined) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9);
  return close(saved.shares, row.shares) && close(saved.avgCostUsd, row.avgCostUsd) && close(saved.avgCostFx, row.avgCostFx) ? "same" : "update";
}
