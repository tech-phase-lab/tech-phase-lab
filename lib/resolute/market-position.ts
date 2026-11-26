// 「4つの位置」 on the market gauge (owner spec, Nov 25: the current cell glows gold with 「いま」, on phone and PC).
// Rows: trend (上向き / 下向き); columns: temperature (冷えている / 熱い). Display only, from the reading already shown.
//  - Trend: the latest close is at or above its 200-day moving average → 上向き, below it → 下向き.
//  - Temperature: the gauge score (0–100, the historical position) is 50 or more → 熱い, under 50 → 冷えている.

/** 0 上向き×冷えている, 1 上向き×熱い, 2 下向き×冷えている, 3 下向き×熱い (the order of the cells). */
export type MarketPosition = 0 | 1 | 2 | 3;

export function marketPosition(input: { score: number; deviationPercent: number } | null | undefined): MarketPosition | null {
  if (!input || !Number.isFinite(input.score) || !Number.isFinite(input.deviationPercent)) return null;
  const rising = input.deviationPercent >= 0, hot = input.score >= 50;
  return ((rising ? 0 : 2) + (hot ? 1 : 0)) as MarketPosition;
}
