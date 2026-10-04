# Company watch layout revision

- Added a compact home entry to the 22-company directory. Swapped the directory and account positions in the expanded menu.
- Removed the duplicate directory heading. Grouped tickers into themed tiles; desktop three columns, mobile two. Coverage definitions remain in a disclosure.
- MU uses a compact back/favorite row without a company selector. Shortened the business description to avoid an orphaned final word.
- Reused the existing TradingView quote/chart below the company header. This is not a Twelve Data connection and carries the existing provider disclaimer.
- Added company activity from the existing public news endpoint. Filters by explicit ticker, uses the existing public renderer, refresh lifecycle and time semantics. Does not change the collector, translation, admission or publication rules.
- Recent activity is a bounded feed window, not full history or proof of no missing news. Errors are distinct from empty results; previously loaded stories are explicitly marked if refresh fails.
- Renamed the four reviewed analysis cards to Earnings insights. They remain manually reviewed and server-gated for PRO; the news readout is public data already exposed by the public endpoint.

Not implemented: persistent change tracking, per-user unread changes, new event alerts, insider tracking, forecast revision history, live Twelve Data prices. These need separate data and product work rather than cosmetic claims.
