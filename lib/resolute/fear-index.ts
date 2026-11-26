// TP恐怖指数 card on the market gauge (owner spec, Nov 25).
// The value is the thermometer feed's `vix.level`: TP Large Cap 100's 20-session realized volatility,
// annualised and in percent, so it reads on the same scale as the VIX. Display only; not part of the temperature.

export type FearLocale = "ja" | "en";
export type FearBand = 0 | 1 | 2 | 3;

/** Band boundaries in percent: <15, 15–20, 20–30, ≥30. A boundary value belongs to the higher band. */
export const FEAR_BOUNDARIES = [15, 20, 30] as const;

export const FEAR_COPY = {
  ja: {
    title: "TP恐怖指数",
    bands: ["落ち着いている", "ふつう", "荒れ始めている", "大きく荒れている"],
    // Natural line-break points for narrow phones; joined, each is exactly the band label (English wraps at its spaces).
    bandPhrases: [["落ち着いて", "いる"], ["ふつう"], ["荒れ始めて", "いる"], ["大きく", "荒れている"]],
    description: "相場がどれだけ荒れているかを表す数字です。VIX指数と同じ目盛りで見られて、数字が大きいほど荒れています。",
  },
  en: {
    title: "TP Fear Index",
    bands: ["Calm", "Normal", "Getting rough", "Very rough"],
    bandPhrases: [["Calm"], ["Normal"], ["Getting rough"], ["Very rough"]],
    description: "Shows how rough the market is. It reads on the same scale as the VIX — the higher the number, the rougher the market.",
  },
} as const satisfies Record<FearLocale, { title: string; bands: readonly string[]; bandPhrases: readonly (readonly string[])[]; description: string }>;

/** Which of the four bands holds the value. */
export function fearBand(value: number): FearBand {
  if (value < FEAR_BOUNDARIES[0]) return 0;
  if (value < FEAR_BOUNDARIES[1]) return 1;
  if (value < FEAR_BOUNDARIES[2]) return 2;
  return 3;
}

/** The ▼ marker's position across the four equal-width bands, 0–100 (percent of the whole bar).
 * It moves within its own band in proportion to the value and stops at the right end from 30 upward. */
export function fearMarkerPosition(value: number): number {
  const band = fearBand(value);
  if (band === 3) return 100;
  const low = band === 0 ? 0 : FEAR_BOUNDARIES[band - 1], high = FEAR_BOUNDARIES[band];
  const within = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return Math.round((band + within) * 25 * 100) / 100;
}

/** 18.6 → "18.6%" (one decimal, with the unit). */
export function formatFearPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
