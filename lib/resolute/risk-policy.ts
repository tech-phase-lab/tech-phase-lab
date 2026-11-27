/**
 * The single place for the Shock Gauge (衝撃度チェッカー) rules. After legal review,
 * change wording or thresholds HERE only; nothing else hard-codes them.
 * Plain values only (no imports) so the Railway worker can load it directly.
 *
 * Stars are mechanical (lawyer review, Nov 2026): no owner or AI judgment, no prediction.
 * Each story has a scope decided from its headline by fixed rules (lib/resolute/risk-scope.ts): market-wide or
 * semiconductor-sector news is measured on BOTH TP大型株100 and TP半導体40 (owner, Nov 25) and its stars are the stronger of the
 * two; the scope only decides which index is listed first. Before its session is measured the story is not shown.
 *
 * Nov 25 (owner, after the SK hynix ★5): a star reflects only the move AFTER publication (risk-market.ts storySession):
 *  - a story published before the U.S. regular open (pre-market, overnight, a weekend or holiday) is measured on that
 *    session, close-to-close;
 *  - a story published during or after regular hours is measured on the NEXT full session (the move that already happened
 *    before the news is never credited to it).
 * Single-company news (a headline naming one company) is measured on its own stock and its industry index (TP半導体40 for chip
 * companies, otherwise TP大型株100); its stars are the higher of the stock's row and the index's row (owner, Nov 26).
 * A company without a measured stock never gets stars.
 * One move, one story: of the stories measured on the same session only the one that best explains it is kept with stars
 * (perSession; rizel-daily-review.mjs).
 *
 * Nov 26 (owner, final): the stars come from a fixed table only (stars.bands). Each index's move is the larger of its close
 * move and its largest intraday move against the previous close (thermometer data: the daily bars' high and low). Market-wide
 * news takes the higher of the two indices. The fear index (TP恐怖指数) up at least fearBump % adds ★1 on a down day only,
 * ★5 at most. No AI judgement and no cause changes the stars; the AI only chooses which stories to list.
 */
export const RISK_POLICY = {
  version: 5,
  stars: {
    method: 'table',
    /** Sessions in the typical-move window (kept as data; the stars no longer use it). */
    typicalDays: 60,
    /** The owner's table (Nov 26, final). Each index's move is the larger of |close move| and |largest intraday move against the
     * previous close|, in %. Lower bounds of ★2, ★3, ★4, ★5; below the first is ★1. The day's stars are the higher index;
     * single-stock news uses the stock's own move with the stock row. */
    bands: {
      nas100: [1, 2, 3.5, 5],
      sox: [1.6, 3.2, 5.6, 8],
      stock: [2, 4, 7, 10],
    },
    /** The fear index rose at least this many % from the day before: ★ +1 (★5 at most). */
    fearBump: 20,
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
  /** The owner's daily pick (owner, Nov 27). Published every day, weekends and U.S. holidays included. At candidateRunJst
   * (candidateRunEarningsJst when a watched company reported after the previous U.S. close, so its results can be candidates) the
   * service builds the day's candidates (`market` market-wide and `company` single-company stories, ranked by how much the news
   * shakes the market or the stock, each with a summary, the measured numbers when there are any and a suggested ★ with a reason)
   * and mails them to the owner. The owner's picks (stories, their ★ and order, plus up to maxAdded stories the owner adds) are
   * accepted until answerUntilJst; at publishRunJst exactly those are published. Without an answer the service picks autoStories
   * itself from all the news up to the publish run (at least autoMinMarket market-wide when there are), with the suggested ★.
   * Times are JST, HH:MM. */
  ownerPicks: { candidateRunJst: '06:00', candidateRunEarningsJst: '06:30', answerUntilJst: '08:00', publishRunJst: '08:20', market: 7, company: 7, autoStories: 3, autoMinMarket: 2, maxStories: 3, maxAdded: 3 },
  dailyStories: 3,
  dailyAttempts: 12,
  maxDailyStories: 5,
  maxDailyAttempts: 20,
} as const;
