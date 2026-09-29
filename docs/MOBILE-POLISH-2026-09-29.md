# Mobile polish — 2026-09-29

User rejected the rectangular logo glint and home TradingView ticker.
- Home ticker removed entirely; retain provider attribution on market widgets.
- Logo shimmer clipped to TECH PHASE letterforms; reduced-motion keeps plain text.
- Calendar verification copy collapsed; slim category tabs, equal-width period/time controls and compact favorites row. Calendar records unchanged.
- Market index strip keeps three equal columns at mobile widths; complete quote embeds are scaled, including attribution. No horizontal swipe required by the container. Real iPhone verification remains pending.
- No new market data subscription, scraping or custom extracted TradingView quotes.

## Follow-up after phone feedback
- Replace individual event cards with dense, expandable agenda rows. Show date/time and event name first; notes, watchpoints and source links appear on expansion. Date-only entries use the same pattern.
- Replace iframe CSS zoom with a measured viewport and transform scaling of the complete 220px-wide widget. Keep copyright attribution and reserve scaled height. No overflowing percentage widths.
