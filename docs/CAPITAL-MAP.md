# CAPITAL MAP / 資本マップ

Owner agreement, 2026-10-12 JST: Japanese menu 資本マップ; English menu and page heading CAPITAL MAP. The pillars are manager portfolios and ETF holdings.

## Implemented first version

- Existing “何が変わった？” menu and home entry now link to `/research/capital-map`. Header/menu decoration remains unchanged. Old research IDs, saved notes and article hashes stay accessible.
- The PRO introduction includes CAPITAL MAP with an explicit in-development label. No payment flow or pricing changes.
- `/research/capital-map` is a preparation screen with no live holdings. `/research/capital-map/sample` is the interactive, public display sample.
- All sample holdings, weights, counts and dates are fictional, including Berkshire, QQQ and SMH. TECH FUND is a fictional manager. The sample is not downloaded SEC or issuer data.
- Composition chart and complete sample list; new/increased/reduced/unchanged/exited share-count changes; option positions explicitly PUT/CALL.
- Ticker inputs filter holders and the selected portfolio; the optional watchlist filter reads all lists without editing them. Inputs are not saved. No matches mean no data in this limited sample, not no real holders.
- Following and viewed-version preferences are browser-local under `tech-phase:capital-map:sample-preferences:v1`; no account or cross-device sync. Storage errors keep session functionality and show that durable saving failed.
- Previous-check comparison uses the explicitly marked disclosure ID. Missing history is not presented as a change. A clearly labelled sample control simulates an earlier viewed version and an update badge.
- ETF overlap sums the smaller of the two weights for each matching security. Share classes are separate. It is not the reader's combined asset allocation.
- Company ownership remains unavailable without a verified outstanding-share denominator. Aggregate institutional ownership and corporate investments are not implemented.
- Japanese/English UI included. Physical smartphone verification is pending.

## Before real data and public launch

1. Verify SEC retrieval and ETF-issuer commercial reuse/display conditions; public access does not establish redistribution rights.
2. Store immutable source-backed snapshots with accession/URL, as-of and published dates, fetch time and completeness. Display latest verified dates rather than claiming live holdings.
3. Map CUSIPs, ADRs, share classes and options. Adjust comparisons for verified splits/corporate actions; unresolved share changes must not be called purchases.
4. Manager composition is within the reported dataset, not total wealth including cash, private assets or net exposure. Option reported notional values are not premium amounts and do not establish directional intent.
5. Handle corrections, shared-manager reporting and duplicates before institutional totals. Verify denominator dates. Do not rename “Others” as retail investors without evidence.
6. Add server-side PRO authorization before returning any agreed paid real datasets. The fictional sample remains public.
7. Decide account persistence of followed managers and visited snapshots; current sample preferences must not be described as synchronized.
8. Distinguish corporate equity investments from business partnerships. Company explainers belong below stock prices in stock search and are separate future work.

News, price targets, their collection/translation/delivery, and RESOLUTE are outside this change. No additional infrastructure or data subscription was purchased.

Sources checked during design:
- https://www.sec.gov/files/divisions/investment/13ffaq.htm
- https://www.sec.gov/about/forms/form13f.pdf
- https://www.invesco.com/qqq-etf/en/about.html

Live retrieval, automatic updates, commercial ETF display permission, institutional totals, corporate investments and smartphone testing are unverified/unimplemented.

## 2026-10-12 disclosure expansion and circle correction

- Normal route now serves the reviewed June 30, 2026 13F snapshots to server-authorized, unexpired PRO members (including the existing owner mode). The public sample stays fictional and links to the normal route. No real holdings are imported into the public static client bundle or sample route. Authorized page responses serialize only the reviewed report data to the signed-in viewer.
- Berkshire: 89 source rows -> 29 security/share-class positions, $299,253,556,246. NVIDIA: 8 -> 8, $63,439,974,569. Alphabet: 29 -> 28, $99,082,057,675. Full XML tables and cover totals were downloaded and reconciled; same-CUSIP rows within each report are summed, never combined across filers.
- Source URLs, accession, source row count, original XML SHA-256, review date, filing date, and as-of date accompany each snapshot. All 65 reported positions are retained. Unmatched symbols remain blank and display CUSIP; no guessed ticker is inserted. These are specific reviewed filings, not a claim that later amendments have been excluded.
- These public 13F tables do not cover all corporate assets, confidential holdings, private investments, or all foreign-listed shares. Quarterly comparisons remain unavailable until previous filings and corporate actions are reconciled. No false new/exit labels are produced from absent history. Company ownership percentages remain unavailable.
- Replace content-sized CSS donut with SVG viewBox and explicit equal width/height. Mobile shows the 160px circle above the legend; all positions appear below, while the circle summarizes top five plus Other.
- Sample and disclosure follow/viewed preferences use separate versioned browser storage. Existing sample ETF comparison remains available. No collection jobs or infrastructure configuration changed.
