# Watchlist quote freshness

This is a presentation guardrail for the future licensed quote feed. The normal page still has no Twelve Data connection; absent quotes remain `—`. The sample page uses fictional prices, dates and quote ages and never changes personal lists.

- Regular/pre/after-hours snapshots older than 5 minutes show `最終取得` / `Last available`.
- A delayed snapshot uses a provisional 20-minute tolerance, intended for the planned 15-minute delayed feed. Validate these constants against the actual licensed feed before connection. This does not diagnose outages or promise a refresh interval.
- A provider-confirmed `closed` snapshot stays a dated close over weekends and holidays. Do not infer exchange status from the client's clock. A collector must correctly supply session metadata and trading dates; this UI does not implement a market calendar.
- A date is shown when the quote is from another JST day, with the year when it differs. Invalid dates or dates more than 1 minute in the future are not displayed as prices once the client clock is available.
- The list checks age every 30 seconds and immediately when the tab regains focus or visibility. No quote requests or alert deliveries are introduced.
- Stale prices and charts remain visible, with a note in the expanded row. The common column header becomes `値動き` / `Change` instead of implying the cached session is current.
- `/research/watchlist/sample` has a data-state selector for recent, stale and 15-minute-delay examples. Selecting the close session demonstrates a fictional weekend close. The timestamps are simulated and independent of the live clock at the top.
