/** What a member loses when PRO ends (owner, Nov 5). Only features that are PRO-only today (docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md);
 * each one is gated in the code too. Add to this list only when a feature really becomes PRO-only. */
export const PRO_ONLY_FEATURES: { ja: string; descriptionJa: string; en: string; descriptionEn: string }[] = [
  { ja: "テーマランキング", descriptionJa: "いま強いジャンルをひと目で確認", en: "Theme Ranking", descriptionEn: "See which themes are strong right now" },
  // The earnings summaries are read inside this page, so they are not a separate item (owner, Nov 5).
  { ja: "監視22銘柄", descriptionJa: "リゼルが見ている22銘柄の動きと、決算後のまとめ", en: "22 tracked stocks", descriptionEn: "The 22 stocks Rizel follows, with post-earnings summaries" },
  { ja: "銘柄比較", descriptionJa: "気になる銘柄を並べて比べる", en: "Stock comparison", descriptionEn: "Compare stocks side by side" },
  { ja: "ハイテク速報のリアルタイム配信", descriptionJa: "無料より30分早く、全件読めます", en: "Real-time Tech Alerts", descriptionEn: "30 minutes earlier than FREE, and every item" },
  { ja: "ウォッチリストの振り返り", descriptionJa: "週末に、登録銘柄の今週の変化をまとめて確認", en: "Watchlist weekly review", descriptionEn: "This week's changes for your stocks, every weekend" },
  { ja: "連関マップ（全社）", descriptionJa: "NVDAの無料サンプル以外の企業のマップ", en: "Relationship maps (all companies)", descriptionEn: "Every map except the free NVDA sample" },
  { ja: "米国株の資産管理", descriptionJa: "持ち株の登録・金額を伏せる表示", en: "U.S. stock portfolio", descriptionEn: "Holdings tracking with hidden-amount display" },
  { ja: "PROのスマホ通知", descriptionJa: "決算・監視株ニュース・経済指標など", en: "PRO phone notifications", descriptionEn: "Earnings, watched-stock news, indicators and more" },
  { ja: "RIZEL'S DESK", descriptionJa: "ひとりごと・リゼルに聞く・週刊PRO", en: "RIZEL'S DESK", descriptionEn: "Notes, Ask Rizel and Weekly PRO" },
];
