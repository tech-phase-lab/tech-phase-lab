# Navigation UI — 2026-10-19

Owner-approved scope on `codex/research-preview`:

- Desktop left-menu Earnings & data links directly to `/research/calendar`. Other legacy financial-metrics links and content remain unchanged.
- Visible favorites labels use ウォッチリスト / Watchlist. Phone dock reserves space for the complete Japanese label.
- Desktop sidebar and menu distinguish ハイテク速報 / Tech Alerts (`/research/news`) from 一般ニュース / General News (`/research/general-news`).
- Tech Alerts displays only rows concerning the 22 tracked stocks. The shared earnings feed and calendar coverage are unchanged.
- General News reads only existing published Stock News `items` through `/api/research/news`; no official, market, preview or company-wire rows are mixed in. Existing loading, unavailable and publication-disabled states remain honest. No acquisition, translation, publication, paid provider settings or home news sources changed.
- Desktop stock search and both watchlist pages use the existing sticky sidebar at 1100px and above. Main content starts at the top and can shrink without overflowing. Mobile keeps its existing layout.
- Stock search Suspense uses the bilingual branded loader; English result counts distinguish `1 result` from plural results.

Verification must be reported separately from implementation. No saved articles, annotations or watchlist entries may be added or removed for this UI check.
