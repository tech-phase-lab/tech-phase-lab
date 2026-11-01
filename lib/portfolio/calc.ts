/** US-stock portfolio arithmetic. Pure: no network, no storage. Money is kept as plain numbers; rounding happens only when shown. */
export type Holding = {
  ticker: string;
  name?: string;
  shares: number;
  /** Average acquisition price in US dollars (what the broker screen shows). */
  avgCostUsd: number;
  /** JPY per USD when it was bought, if the screen showed the yen cost too (cost in yen / cost in dollars). */
  avgCostFx?: number;
};
export type Quote = { ticker: string; close: number; asOf: string };
export type Row = {
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

export function valueHoldings(holdings: readonly Holding[], quotes: Readonly<Record<string, Quote | undefined>>, usdJpy: number | null): { rows: Row[]; totals: Totals } {
  const rows: Row[] = holdings.map(h => {
    const quote = quotes[h.ticker];
    const costUsd = h.shares * h.avgCostUsd;
    const price = quote && Number.isFinite(quote.close) && quote.close > 0 ? quote.close : null;
    const valueUsd = price === null ? null : h.shares * price;
    const gainUsd = valueUsd === null ? null : valueUsd - costUsd;
    const valueJpy = valueUsd === null || usdJpy === null ? null : valueUsd * usdJpy;
    // Yen gain needs the rate at the time of purchase; without it the yen profit is not guessed.
    const gainJpy = valueJpy !== null && h.avgCostFx !== undefined ? valueJpy - costUsd * h.avgCostFx : null;
    return { ticker: h.ticker, name: h.name, shares: h.shares, avgCostUsd: h.avgCostUsd, avgCostFx: h.avgCostFx,
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
