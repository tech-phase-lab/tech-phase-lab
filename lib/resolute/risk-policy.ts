/**
 * The single place for the Shock Gauge (衝撃度チェッカー) rules. After legal review,
 * change wording or thresholds HERE only; nothing else hard-codes them.
 * Plain values only (no imports) so the Railway worker can load it directly.
 *
 * Stars are mechanical (lawyer review, Nov 2026): no owner or AI judgment.
 * Each story has a scope decided from its headline by fixed rules (lib/resolute/risk-scope.ts): market-wide news is measured
 * on TP大型株100, semiconductor-sector news on TP半導体40, and news about one company gets no stars (one stock's move is not
 * a market shock). The index's % change vs the previous close at the FIRST U.S. market close after the news decides the
 * stars from the absolute move, with thresholds per index. Before that close the story shows no stars ("waiting").
 *
 * Nov 25 recalibration (owner: 「星5なんて滅多に出なくて良い」; ★5 = an extreme, historic-scale move such as Nov 20's
 * Nasdaq drop, ★4 = a very large move such as a −7% semiconductor day). Share of sessions per star, measured on the
 * equal-weight proxies of the two baskets (QQEW for TP大型株100, Aug 2025–Nov 2026, 325 sessions; Nasdaq-100 Jan 2024–Nov
 * 2026, 724 sessions; XSD for TP半導体40, 325 sessions):
 *   TP大型株100: ★1 59% ★2 30% ★3 7% ★4 3% ★5 0.6–0.9%
 *   TP半導体40: ★1 55% ★2 25% ★3 13% ★4 5.5% ★5 0.9%
 */
export const RISK_POLICY = {
  version: 3,
  stars: {
    method: 'market-move',
    /** Lower bounds (absolute % move, rounded to 0.1) for ★2..★5 per index. */
    thresholds: { nas100: [1, 2, 3, 5], sox: [2, 4, 6, 10] },
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
  /** Shown instead of stars for news about a single company (no index measures one company's news). */
  company: { ja: '個別企業のニュース（★はつけません）', en: 'Single-company news (no stars)' },
  /** At most this many stories per index and U.S. close (owner, Nov 25: never three stories on the same move). */
  perIndexSession: 1,
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
  /** Up to this many stories a day; the next candidates are tried only when one fails the checks (bounded AI cost).
   * Nov 24: five attempts were too few once the whole window is read (opinion pieces and quiet stories are withheld by the
   * model); twelve cost about ¥0.7 each. RESOLUTE_RIZEL_DAILY_STORIES / RESOLUTE_RIZEL_DAILY_ATTEMPTS change them up to the caps. */
  dailyStories: 3,
  dailyAttempts: 12,
  maxDailyStories: 5,
  maxDailyAttempts: 20,
} as const;
