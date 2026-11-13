# Earnings flash backtest

Generated 2026-11-12 11:40Z 

| Ticker | Latest results filing (SEC) | Exhibit | Parser | Shape of text |
|---|---|---|---|---|
| MU | 8-K 2026-09-30T20:02Z | 18676 chars | none yet | revenue row; quarter heading |
| SKHY | no SEC route | - | - | - |
| SNDK | 8-K 2026-10-29T20:13Z | 25742 chars | none yet | revenue row; quarter heading |
| NBIS | 6-K 2026-08-12T13:15Z | 25444 chars | PDF route (see NBIS) | no revenue row; quarter heading |
| NVDA | none in 130 days | - | - | - |
| AMD | 8-K 2026-11-03T21:16Z | 24429 chars | none yet | revenue row; quarter heading |
| AVGO | 8-K 2026-09-02T20:26Z | 23094 chars | none yet | revenue row |
| ARM | 6-K 2026-11-04T21:02Z | 1952 chars | none yet | no revenue row |
| TSM | none in 130 days | - | - | - |
| ASML | 6-K 2026-10-14T10:01Z | 12161 chars | none yet | no revenue row; quarter heading |
| MRVL | 8-K 2026-08-27T20:05Z | 30238 chars | none yet | revenue row |
| ANET | 8-K 2026-11-03T21:10Z | 19480 chars | none yet | revenue row; quarter heading |
| CRDO | 8-K 2026-09-01T20:08Z | 15206 chars | none yet | revenue row |
| CRWV | 8-K 2026-11-10T21:05Z | 26087 chars | revenue $3.661B, eps $-1.27, net-income $-709M | revenue row; quarter heading |
| VRT | 8-K 2026-10-28T10:02Z | 39890 chars | none yet | no revenue row; quarter heading |
| GEV | 8-K 2026-10-28T10:16Z | 35642 chars | none yet | revenue row; quarter heading |
| DELL | 8-K 2026-09-01T20:10Z | 28590 chars | none yet | revenue row |
| PLTR | 8-K 2026-11-02T21:06Z | 23559 chars | none yet | revenue row; quarter heading |
| MSFT | 8-K 2026-10-28T20:04Z | 19536 chars | none yet | revenue row |
| AMZN | 8-K 2026-10-29T20:05Z | 37103 chars | none yet | no revenue row; quarter heading |
| GOOGL | 8-K 2026-10-28T20:01Z | 24400 chars | none yet | revenue row; quarter heading |
| ORCL | no SEC route | - | - | - |

## Reading the table
- "Parser: none yet" means the company's results press release is reachable from SEC EDGAR and has the shape of a results table, but no
  deterministic parser exists for it, so no numbers-only flash would be published today. Only CRWV (SEC exhibit) and NBIS (PR PDF) have one.
- ARM, ASML, VRT, AMZN, NBIS show "no revenue row" in the exhibit text: the numbers are in a PDF or in a differently worded table.
- SKHY and ORCL have no SEC route at all; they depend on the company's own IR page.
- NVDA and TSM had no matching filing in the last 130 days in this run (NVDA reports on Nov 17; TSM files its results as 6-K exhibits that need a separate check).
- This backtest checks detection (a filing exists and its exhibit can be read) and parser coverage. It does not yet compare parsed numbers with the original text for the
  other companies, because there is no parser to compare. Adding a parser for a company means adding it to `issuer_result_flash.PROFILES` with fixtures from this run.
