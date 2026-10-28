# Home and news pulse — 2026-09-29

User approved: subtle brand glint, market movement, home ticker, three index cards,
All / Official / Price targets filters, explicit free PRO sample, richer earnings.

Implemented:
- TradingView-only quotes: CFD reference labels, static three-card market strip,
  home tape with pause and reduced-motion support. No scraped prices.
- Brand glint once per eight seconds, disabled for reduced motion.
- Shared news filter on home and news page; official raw updates explicitly remain
  original-source links pending Japanese summaries (OpenAI is not configured).
- MU q3 remains agreed public example, visibly labelled as a PRO sample.
- Price-target parser handles PT / target price, reversed from/to and additional
  named firms. Late and baseline observations can appear in seven-day history.
  Only the three analyst accounts are accepted; unknown firms/unparseable or
  multiple-ticker posts still require review. Do not claim universal coverage.
- Push independently checks publication freshness (15 minutes) so late historical
  discoveries never create fresh alerts.
- Six scheduled earnings now include editorial metrics to watch. No invented dates,
  estimates, results or new consensus data were added.
- Beginner guide adds account-to-first-order steps and separates shares from FX/CFDs.

Outstanding:
- Authenticated live X route diagnostics and new fetch/backfill have NOT been verified
  in this session: no local editor/X credentials. Vercel fetch previously returned
  authentication protection. Inspect /admin/signals via authorized editor session.
- Check live X_API_DAILY_REQUEST_LIMIT before promising immediate acquisition.
  Default 100 requests/day across four X routes implies pacing; do not raise paid
  budgets without user's informed spend authorization. Three analyst feeds configure
  60-second intervals but pacing can dominate them.
- Broaden parser based on real captured posts, not guessed numbers. Unparsed items
  must remain reviewable. Preserve publication versus discovery timestamps.
- Further calendar schedule expansion still owned by hourly continuation; integrate
  its branch changes and never overwrite verified calendar work.
- Broker affiliate links not supplied. Vantage Trading Ltd appears on FSA warning
  list (August 2026): https://www.fsa.go.jp/ordinary/chuui/mutouroku/04.html .
  Verify exact legal entity, target jurisdiction and promotion terms before placing
  a referral. Do not list as a recommended beginner US-share account.
