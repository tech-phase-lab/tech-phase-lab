# Six-part stock introductions

The stock-search price panel now includes six editorial answers in Japanese and
English: 何の会社？ / どこで稼ぐ？ / 何が強い？ / 競合は？ / どことつながる？ / 弱点は？.

The scope is every searchable issuer, independent of the monitored-news universe.
Researched coverage is nineteen issuers / twenty tickers: NVDA, MU, GOOG,
GOOGL, AAPL, AMZN, META, COST, MSFT, NBIS, TSM, ASML, AVGO, AMD, ARM, CRDO,
ANET, MRVL, VRT and ALAB.
The second batch was reviewed on 2026-10-13 using the linked annual filings;
Arm's June 2026 report also confirms its expansion into designed silicon products.
The third batch adds networking and data-center infrastructure companies, reviewed
on 2026-10-13. Each record links its annual filing; suppliers and competitors are
identified by role, without treating an unnamed customer as a confirmed company.
This is not full-directory coverage. Uncovered
issuers retain their existing approved annual-brief behavior; no generic or
automatically generated introduction is substituted. No automatic research or
update job has been enabled.

Records live in `lib/research/company-introductions.ts`. The profile API selects
by both SEC CIK and ticker and returns only that issuer's record. The client
imports types only, so adding companies does not ship the whole registry to
every visitor. Both Google share classes share one Alphabet issuer record.
Leveraged ETFs and an unrelated issuer with the same ticker must not match.

To extend coverage, verify the selected issuer's annual report, relevant newer
filings and official announcements; write all six answers in both languages;
attach primary-source URLs and an actual content-review date. Relationships
must describe the relationship (supplier, customer, platform, etc.), not merely
list logos. Competitor examples require source verification. Do not equate an
old annual-report date with current holdings, management or market share.

The initial editorial summaries use the Business and Risk Factors sections of
the linked filings. Strengths are concise explanations of the business model,
not a ranking or investment recommendation. No investment targets are included.
Sources and review date are collapsed beneath the cards. A covered issuer skips
the redundant legacy brief request; its official-filings drawer remains.

The news/translation/price-target pipelines and RESOLUTE are outside this change.
