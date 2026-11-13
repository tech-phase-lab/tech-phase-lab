# Earnings flash pass/fail (latest real release of each watch-list company)

Generated 2026-11-13 09:32Z · PASS 20 / 22

| Ticker | Verdict | Detection source | Figures | Reason |
|---|---|---|---|---|
| MU | PASS | SEC 8-K 2026-09-30T20:02Z | 4 | 4 figures, e.g. revenue $54.229B |
| SKHY | FAIL | no route | 0 | no release text found |
| SNDK | PASS | SEC 8-K 2026-10-29T20:13Z | 4 | 4 figures, e.g. revenue $11.031B |
| NBIS | PASS | newsroom page | 3 | 3 figures, e.g. revenue $980.8M |
| NVDA | PASS | SEC 8-K 2026-08-26T20:21Z | 6 | 6 figures, e.g. revenue $96.221B |
| AMD | PASS | SEC 8-K 2026-11-03T21:16Z | 4 | 4 figures, e.g. revenue $13.377B |
| AVGO | PASS | SEC 8-K 2026-09-02T20:26Z | 4 | 4 figures, e.g. revenue $29.591B |
| ARM | FAIL | SEC 6-K 2026-11-04T21:02Z | 0 | no parser for this company yet |
| TSM | PASS | SEC 6-K 2026-10-15T10:40Z | 5 | 5 figures, e.g. revenue NT$1494.243B |
| ASML | PASS | SEC 6-K 2026-10-14T10:01Z | 4 | 4 figures, e.g. revenue €11.662B |
| MRVL | PASS | SEC 8-K 2026-08-27T20:05Z | 4 | 4 figures, e.g. revenue $2.7393B |
| ANET | PASS | SEC 8-K 2026-11-03T21:10Z | 4 | 4 figures, e.g. revenue $3.6576B |
| CRDO | PASS | SEC 8-K 2026-09-01T20:08Z | 4 | 4 figures, e.g. revenue $479.003M |
| CRWV | PASS | SEC 8-K 2026-11-10T21:05Z | 5 | 5 figures, e.g. revenue $3.661B |
| VRT | PASS | SEC 8-K 2026-10-28T10:02Z | 4 | 4 figures, e.g. revenue $4.3128B |
| GEV | PASS | SEC 8-K 2026-10-28T10:16Z | 4 | 4 figures, e.g. revenue $12.642B |
| DELL | PASS | SEC 8-K 2026-09-01T20:10Z | 4 | 4 figures, e.g. revenue $46.971B |
| PLTR | PASS | SEC 8-K 2026-11-02T21:06Z | 4 | 4 figures, e.g. revenue $2.313411B |
| MSFT | PASS | SEC 8-K 2026-10-28T20:04Z | 4 | 4 figures, e.g. revenue $92.279B |
| AMZN | PASS | SEC 8-K 2026-10-29T20:05Z | 4 | 4 figures, e.g. revenue $201.944B |
| GOOGL | PASS | SEC 8-K 2026-10-28T20:01Z | 4 | 4 figures, e.g. revenue $127.577B |
| ORCL | PASS | SEC 8-K 2026-09-10T20:16Z | 4 | 4 figures, e.g. revenue $19.345B (found via SEC: the earlier "no route" was the backtest rejecting the "Q1 Results" title) |

## How this table is made
`python3 scripts/research/earnings_backtest.py` (add `--json` for a machine-readable copy) takes each company's **latest real release** (SEC 8-K Item 2.02 or 6-K exhibit;
Nebius: the release PDF linked from its newsroom page) and runs the same parser the monitor uses. PASS means at least three reported figures were read and each
passed the parser's own consistency checks (stated changes agree with the values). It reads public filings only and publishes nothing.
FAIL is not a verdict on the company's data: it means this site cannot yet publish that company's figures, so the site shows only
"決算を発表しました" with the official link for it. Adding a company = a parser in `issuer_result_flash.PROFILES` with fixtures from this run.
Run it before each earnings season, after any company or source change, and daily (a Railway cron job needs the owner's approval).
Note: the monitor runs pypdf 6.10.0, which splits words and numbers inside PDFs; this script may run a newer pypdf, so a PASS for the Nebius PDF here is not proof for production.
