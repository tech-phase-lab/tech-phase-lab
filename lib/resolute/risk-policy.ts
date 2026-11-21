/**
 * The single place for the Shock Gauge (衝撃度チェッカー) rules. After legal review,
 * change wording or thresholds HERE only; nothing else hard-codes them.
 * Plain values only (no imports) so the Railway worker can load it directly.
 *
 * Stars are mechanical (lawyer review, Nov 2026): no owner or AI judgment.
 * One related TP index per story (TP半導体40 when the story names a constituent or is about
 * semiconductors / AI chips, otherwise TP大型株100). Its % change vs the previous close at the
 * FIRST U.S. market close after the news decides the stars from the absolute move.
 * Before that close the story shows no stars ("waiting for the market's reaction").
 */
export const RISK_POLICY = {
  version: 2,
  stars: {
    method: 'market-move',
    /** Lower bounds (absolute % move, rounded to 0.1) for ★2..★5: <1 ★1, 1–2 ★2, 2–3 ★3, 3–5 ★4, ≥5 ★5. */
    thresholds: [1, 2, 3, 5],
  },
  /** Names shown next to the stars (EN names match the thermometer page). */
  indices: {
    sox: { ja: 'TP半導体40', en: 'TP Semiconductor 40' },
    nas100: { ja: 'TP大型株100', en: 'TP Large Cap 100' },
  },
  /** Stars at or above this make the day's action "reread your rules". */
  reviewMinStars: 4,
  /** Shown instead of stars until the first U.S. close after the news. */
  waiting: { ja: '市場の反応待ち', en: 'Waiting for the market’s reaction' },
  /** Note under the stars (lawyer-reviewed wording, Nov 2026). */
  note: {
    ja: '★は、ニュースのあとに関連するTP指標が実際にどれだけ動いたかで決めています。今後の値動きを示すものではありません。売買の判断は、あなた自身でおこなってください。',
    en: 'Stars show how much the related TP index actually moved after the news. They don’t predict future prices. Any decision to buy or sell is yours.',
  },
  /** Status lines shown when there are no stories to list. */
  status: {
    preparing: { ja: '準備中です', en: 'Coming soon.' },
    quiet: { ja: '今日は、気にするニュースはありません', en: 'No news needs your attention today.' },
    failed: { ja: 'ニュースを更新できていません', en: 'We couldn’t update the news.' },
    stopped: { ja: 'ニュースの公開を停止しています', en: 'News updates are paused.' },
  },
  /** Daily collection window: hours back from the morning run (Monday covers the weekend). */
  lookbackHours: { weekday: 30, monday: 78 },
  /** The weekday morning run (JST hour), Mon–Fri. 08:00 JST is after the thermometer stores the previous U.S. close
   * (about 08:00–08:05 JST), so a story published before that close gets its stars in the same run (owner, Nov 21).
   * The Railway cron of resolute-rizel-daily-review must start inside this hour (20 23 * * 0-4 = 08:20 JST). */
  runHourJst: 8,
  /** Up to this many stories a day; the next candidates are tried only when one fails the checks (bounded AI cost). */
  dailyStories: 3,
  dailyAttempts: 5,
} as const;
