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
