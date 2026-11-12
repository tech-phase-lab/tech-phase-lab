/**
 * The single place for the "today's news risk" criteria. After legal review,
 * change wording or thresholds HERE only; nothing else hard-codes them.
 * Plain values only (no imports) so the Railway worker can load it directly.
 * The model never assigns stars: stars are computed from these tables.
 */
export const RISK_POLICY = {
  version: 1,
  rubric: {
    version: 1,
    source: { sns: 0, report: 1, official: 2 },
    scope: { company: 0, sector: 1, market: 2 },
    duration: { days: 0, months: 1, years: 2 },
    impact: { opinion: 0, possible: 1, confirmed: 2 },
    // Total points needed for star 1..5 (0-1 → ★1, 2-3 → ★2, 4-5 → ★3, 6 → ★4, 7-8 → ★5).
    thresholds: [0, 2, 4, 6, 7],
  },
  /** Stars at or above this make the day's action "reread your rules". */
  reviewMinStars: 4,
  /** Footer note under the checker (owner-approved wording; change after legal review if needed). */
  note: {
    ja: "※危険度の主な基準は、出どころ・範囲・時間の長さです",
    en: "Risk levels are mainly based on the source, scope and time frame.",
  },
  /** Status lines shown when there are no stories to list. */
  status: {
    preparing: { ja: "準備中です", en: "Coming soon." },
    quiet: { ja: "今日は、気にするニュースはありません", en: "No news needs your attention today." },
    failed: { ja: "ニュースを更新できていません", en: "We couldn’t update the news." },
    stopped: { ja: "ニュースの公開を停止しています", en: "News updates are paused." },
  },
  /** Daily collection window: hours back from the 07:00 JST run (Monday covers the weekend). */
  lookbackHours: { weekday: 30, monday: 78 },
} as const;
