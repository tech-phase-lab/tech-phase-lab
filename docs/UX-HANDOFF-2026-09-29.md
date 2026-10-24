# Research preview UX — 2026-09-29

- Rename coverage navigation to 監視22銘柄リスト. Actual coverage status remains distinct.
- News: six official/general entries per page; price targets: four per page. Numbered controls clamp after feed shrink and filters reset news pages.
- Public feeds reuse in-memory snapshots younger than two minutes during navigation; news refresh remains 30 seconds. No private comparison or membership data goes into persistent browser storage.
- Research layout shares verified membership presentation. Opening the menu no longer resets it to Free; unknown status does not show a Free lock. Comparison is first in both menus. Protected routes continue server-side entitlement checks; PRO display expires and membership changes invalidate it.
- Comparison defaults to conclusion and concise company summaries. Detailed financials, caveats and sources are expandable. Valuation remains pending price/forecast integration; no invented score.
- First network requests still take time. This change avoids repeated clearing/loading flashes, not a promise of zero network latency.

## Pending user content
FAQ answers will be supplied by RIZEL; do not author or publish them as approved answers. Beginner guide remains next priority after these UX fixes.
