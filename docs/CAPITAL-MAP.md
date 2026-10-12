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

## 2026-10-12: focused portfolio UI and expanded coverage

- Main view now has Managers / Companies / ETF / Find holders / Compare ETFs. The reverse lookup lives in its own tab, named 銘柄から保有先を探す. Lookup only includes stock holdings; puts/calls do not imply equity ownership.
- Removed development-status banners, unavailable ownership columns and repeated explanatory paragraphs. Dates remain visible; sources and scope are collapsed under データについて. Fictional sample stays explicitly labeled.
- Managers: Berkshire, Pershing Square, Bridgewater, Appaloosa, Coatue, Tiger Global, Viking Global and Fundsmith. Corporate holdings remain NVIDIA and Alphabet. Each manager retains every disclosed security/instrument; totals reconcile exactly with its SEC cover.
- ETF equity lists: SPY 504, SMH 25, SOXX 30, XLK 75, XLF 76. Issuer dates: October 8 except SOXX October 9. Cash, money-market positions and futures are excluded from the list and overlap. Published weights are kept without renormalization; remainder stays in Other. SSGA does not provide market values in these files, so those rows store `value: 0` and display shares/weights only. No dollar value is inferred.
- The importer `scripts/capital-map/import-reviewed.py` accepts a directory of downloaded originals named by `sources.json`; requires `openpyxl` for XLSX. It validates cover totals, unique positions and equity weight totals. URLs and SHA-256 hashes are included in snapshots. SEC ticker mappings reuse previously checked identifiers and issuer-provided CUSIPs; unmatched securities retain their CUSIP. This is an explicit snapshot import, not an automatic collection process.
- Duquesne was reviewed but excluded: the table sum 5,210,856 differs from cover 5,210,860 and its units require verification. No estimated conversion was published. A third-party search mislabeled CIK 1600064 as Fundstrat; the official cover identifies Tidal. That filing was excluded. Fundsmith uses verified CIK 1569205.
- Lists show 50 rows initially with Show more and a local holdings filter. Full data remains available, including all 997 Bridgewater entries. Favorites and viewed records retain their existing mode-separated local storage.
- Quarterly comparisons and automatic refresh remain future work; do not describe these dated imports as live. Existing sample comparisons remain functional.

## 2026-10-12: compact allocation layout

- Show each snapshot date explicitly as `YYYY-MM-DD時点` / `As of YYYY-MM-DD`.
- Portfolio name appears only in the selector; remove duplicate category labels, favorite filter and star action. Existing stored preferences are preserved for compatibility; viewed records still work.
- Keep the square SVG chart left of its legend on desktop and narrow screens. Label the metric as portfolio allocation / share of holdings value.
- Rename the list 全保有銘柄, label its weight column, and use a search scoped to this list. Remove the watchlist filter from this view; it remains available in holder search.
- Compact the default rows to company/ticker and weight. Source data, all positions and sample change comparisons are retained; share counts and dollar values no longer occupy extra row space.

## 2026-10-12: explain the portfolio, holder search and ETF overlap

- Replace the duplicate top-five legend with a company profile and total disclosed holdings value; chart colors match the first five rows in the full list. All eight managers have bilingual short descriptions and named founders/leaders, with official source links.
- Portraits: Buffett (USA International Trade Administration, public domain), Ackman (Senate Democrats, CC BY 2.0), Dalio (Hedge Funds, CC BY 3.0), Tepper (Appaloosa Management, CC BY-SA 3.0), via Wikimedia Commons. Original image URLs, credits and licenses are displayed under About this data. Images use a cropped display frame and gracefully omit a failed image. Remaining managers show verified names/roles without an unverified portrait.
- Role review date is separate from holdings date. Buffett is Chairman Emeritus per the September 18, 2026 release; Greg Abel is current CEO. Dalio is labeled founder, not current investment decision-maker. A person's profile does not attribute all disclosed positions to that individual.
- Restore compact value and share-change columns. Dollar amounts use locale-aware compact formatting with exact values in titles. Missing issuer values render a dash, never a fabricated zero. Real prior snapshots remain uncollected; the visible dash explanation makes this different from zero change. Existing fictional sample share comparisons remain functional.
- Rename holder lookup to Search by stock / 銘柄から探す. Explain what the results mean, accept English company names or exact tickers, and offer NVDA/AAPL/MU example buttons. Watchlists are explicitly a search input source. Multiple terms are comma-separated.
- ETF comparison leads with the question of overlapping investments, a shared-stock count and overlapping allocation. A worked example uses the actual selected pair. The table names both ETFs once in its column headings and includes company names. The calculation remains the sum of minimum weights for shared securities, keeping share classes separate; it is not correlation, a return forecast or a diversification recommendation.
- No news, price-target, ingestion or RESOLUTE code was changed.

## 2026-10-12 visual redesign

- Reference: user supplied portfolio infographics. Larger square SVG donut (up to 440 px desktop / 360 px phone); top ten distinct colors, direct labels for weights >= 5%, neutral remainder.
- One holdings list alongside the chart on wide screens, below it on narrow screens. Color markers and absolute 0–100% weight bars use the same palette. Values and share changes remain available; missing comparisons remain unknown.
- Compact profile strip and date / holding count / top-five concentration metrics replace the small chart / large biography arrangement.
- Consolidated accumulated CSS overrides into a single responsive stylesheet.
- Replaced the Ray Dalio image with the visually reviewed Grameen America September 2017 speech photograph (CC BY 3.0); portrait uses a face-focused CSS crop and retains attribution.
- No holdings values or prior-period data changed. Public sample remains fictional.
