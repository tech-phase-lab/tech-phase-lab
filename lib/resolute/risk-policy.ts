/**
 * The single place for the Shock Gauge (衝撃度チェッカー) rules. After legal review,
 * change wording or thresholds HERE only; nothing else hard-codes them.
 * Plain values only (no imports) so the Railway worker can load it directly.
 *
 * Stars are mechanical (lawyer review, Nov 2026): no owner or AI judgment, no prediction.
 * Each story has a scope decided from its headline by fixed rules (lib/resolute/risk-scope.ts): market-wide or
 * semiconductor-sector news is measured on BOTH TP大型株100 and TP半導体40 (owner, Nov 25) and its stars are the stronger of the
 * two; the scope only decides which index is listed first. Before its session's close the story shows no stars ("waiting").
 *
 * Nov 25 (owner, after the SK hynix ★5): a star reflects only the move AFTER publication (risk-market.ts storySession):
 *  - a story published before the U.S. regular open (pre-market, overnight, a weekend or holiday) is measured on that
 *    session, close-to-close;
 *  - a story published during or after regular hours is measured on the NEXT full session (the move that already happened
 *    before the news is never credited to it).
 * Single-company news (a headline naming one company) is measured too, and gets stars only when, on its session, BOTH its
 * own stock moved strongly against its usual move (companyTest.minMultiple) AND its industry basket did (TP半導体40 for chip
 * companies, otherwise TP大型株100; companyTest.industryMinMultiple), the same way. Its stars are then the industry basket's,
 * by the same levels. A company without a measured stock in either basket never gets stars.
 * One move, one story: of the stories measured on the same session only the one that best explains it is kept with stars
 * (perSession; rizel-daily-review.mjs).
 *
 * Nov 25 (owner-approved method): the stars measure the SHOCK of that close, from three measured parts (thermometer data,
 * the same daily closes the thermometer already reads: no extra provider calls):
 *  - multiple: |index move| ÷ the index's typical daily move (the median of its absolute daily % moves over the 60 sessions
 *    before), rounded to 0.1 — "ふだんの何倍の動きか". −3% in a calm market counts more than in a turbulent one. A median, so a
 *    few crash days do not shrink every later move (thermometer-basket.ts sessionShock).
 *  - breadth: constituents that moved the same way as the index ÷ constituents priced on both days — "40社中37社が下落".
 *  - fear: change of TP恐怖指数 (20-session realized volatility of TP大型株100, annualized) that day vs the day before,
 *    in whole % — "恐怖指数+18%". Only a rise counts, and only on a DOWN move (owner, Nov 25):
 *    TP恐怖指数 is realized volatility, which also rises on a big UP day, so on an up move the fear condition is not
 *    required (★5 on an up move = at least 5× and at least 80% of constituents up). TP恐怖指数 itself is unchanged
 *    (the thermometer shows it on the VIX scale), and the card does not show the fear line on an up move.
 * The stars are the highest level whose every condition holds. The levels are fixed by what they mean (owner, Nov 25), never
 * tuned to a share of days: if nothing extreme happens for months there is no ★5; in a crisis there can be many.
 */
export const RISK_POLICY = {
  version: 5,
  stars: {
    method: 'shock',
    /** Sessions in the typical-move window (median of absolute daily moves). */
    typicalDays: 60,
    /** Highest first. multiple: at least this many times the typical move; breadth: at least this % of constituents moved the
     * same way; fear: TP恐怖指数 rose at least this many % — required on a DOWN move only (an up move needs only multiple and
     * breadth: ★5 up = ≥5× and ≥80% up). null = not required. A level below these is ★1. */
    levels: [
      // ★5 a historic-scale shock: five ordinary days in one, nearly the whole index the same way, and fear jumping
      // (Nov 20: TP大型株100 about −5.4%, six times its typical move).
      { stars: 5, multiple: 5, breadth: 80, fear: 10 },
      // ★4 a very large, broad shock (a −7% to −8.5% semiconductor day in a turbulent market is about three to four times).
      { stars: 4, multiple: 3, breadth: 80, fear: null },
      // ★3 a large move shared by most of the index.
      { stars: 3, multiple: 2, breadth: 70, fear: null },
      // ★2 clearly bigger than an ordinary day.
      { stars: 2, multiple: 1.5, breadth: null, fear: null },
    ],
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
  /** Note under the stars: the same wording as Terms 第20条4項 (owner, Nov 25), no longer than the note it replaced. */
  note: {
    ja: '★は、ニュースのあとの実際の指標の動きと記事の内容から、一過性かどうかを吟味して算出した目安であり、今後の値動きや売買の時期を示すものではありません。',
    en: 'Stars weigh actual index moves after the news and whether the article’s cause looks one-off. They don’t show future prices or when to trade.',
  },
  /** Shown instead of stars for single-company news that did not pass the two-move test (or cannot be measured). */
  company: { ja: '個別企業のニュース（★はつけません）', en: 'Single-company news (no stars)' },
  /** Shown instead of stars when the session moved against the headline's own direction (owner, Nov 25). */
  oppositeMove: { ja: '見出しと逆の向きに動いたため、★はつけません', en: 'The market moved against the headline (no stars)' },
  /** Single-company news (owner, Nov 25): stars only when, on the story's session, the company's own stock moved at least
   * minMultiple times its usual daily move (the median of its absolute daily % moves over the typicalDays sessions before)
   * AND its industry basket moved at least industryMinMultiple times its usual move, both the same way. */
  companyTest: { minMultiple: 3, industryMinMultiple: 1.5 },
  /** At most this many starred stories per U.S. session (owner, Nov 25: one move is never given to several stories). */
  perSession: 1,
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
