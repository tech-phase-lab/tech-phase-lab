# Earnings flash: acceptance criteria and status (owner requirements, 2026-11-12)

Applies to every company on the watch list (22) for earnings detection and the flash, and to the 50 High-tech Alerts companies for
dates. A company that does not pass is **not** sold as 決算の深掘り on the site: it shows "決算を発表しました" and the official link only.

## Criteria (each company, each quarter)
1. **Detection**: a one-line "results announced" with the official link within 10 seconds of the official publication, from at least two
   independent routes (company IR / feed, SEC 8-K Item 2.02 or 6-K, official wire). A failing route shows on /health and alerts the operator.
2. **Figures**: at least three of revenue, year-over-year change, profit/EPS, guidance, capex that the company published, each equal to the
   original text (exact row or sentence; otherwise omitted).
3. **Quality**: no figure shown twice; no thin result built from a social post; nothing shown below the floor.
4. **Phone alert**: the owner's device receives the earnings alert.
5. **Key points** (later): each with a quotation from the original; numbers, direction and negation checked mechanically.
6. **Reproduction**: the latest real release of each company is replayed daily (scripts/research/earnings_backtest.py, docs table below);
   a changed PDF or table layout is detected and reported, and the thin display is never published as a fallback.

## Status after 2026-11-12 (honest)
| Criterion | State |
|---|---|
| 1 Detection ≤10 s, two routes | Not measured. NBIS: monitor polls the newsroom every 5 s; official page appeared ~12:11 UTC. No second route per company yet. |
| 2 Figures (parser) | CRWV (SEC exhibit) passes; NBIS parser works on the real PDF in a test but production read failed on Nov 12 (damaged heading), fix in review. 20 companies have no parser (see docs/EARNINGS-BACKTEST-2026-11-12.md). |
| 3 Quality floor | Implemented in review (≥3 figures; X dropped once the company's table is read; no repeated figures). |
| 4 Phone alert | Failed on Nov 12: no alert reached a phone. /health now shows skip reasons and a device breakdown; cause still being confirmed (owner device mapping, access expiry, quiet hours). |
| 5 Key points | Not built. |
| 6 Daily reproduction | Backtest script exists and was run once by hand; not scheduled; no /health or operator view yet. |

Companies currently passing criterion 2: CRWV only (NBIS pending the fix). All others: do not present as 決算深掘り.

## Plan (owner decision 2026-11-12: no new paid contracts; production in about one month)
Scope of data: the current subscriptions only (Twelve Data, Stock News API, OpenAI, Railway, Vercel, Cloudflare) and free public data (SEC EDGAR, company IR).
"Absolutely fine" is shown by measurement, updated weekly to the owner: the 22-company pass/fail table, the daily automatic check, and measured results of real releases.

| Week | Goal |
|---|---|
| 1 | NBIS, CRWV and AMAT fully: detection ≤10 s, ≥3 figures, phone alert reaches the owner's device; thin displays removed from production. |
| 2 | Add parsers by market cap and nearest earnings date until half of the 22 pass. |
| 3 | The remaining companies; SKHY and ORCL (no SEC route) through their official IR / wire routes. |
| 4 | Full 22-company reproduction run, backup routes, anomaly alerts, operator one-screen view, earnings-call summary from the company's official documents (shareholder letter, prepared remarks) with quotations. |

Call Q&A is added only from an official published transcript. No unlicensed transcripts, no paid transcription provider (owner withdrew that research).
Delays are reported early with the reason and an alternative.
