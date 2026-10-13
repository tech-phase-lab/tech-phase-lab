# Six-part stock introductions

The stock-search price panel now includes six editorial answers in Japanese and
English: 何の会社？ / どこで稼ぐ？ / 何が強い？ / 弱点は？ / 競合は？ / どこと繋がる？.

The scope is every searchable issuer, independent of the monitored-news universe.
Researched coverage is twenty-three issuers / twenty-four tickers: NVDA, MU, GOOG,
GOOGL, AAPL, AMZN, META, COST, MSFT, NBIS, TSM, ASML, AVGO, AMD, ARM, CRDO,
ANET, MRVL, VRT, ALAB, LITE, COHR, AMAT and APH.
The second batch was reviewed on 2026-10-13 using the linked annual filings;
Arm's June 2026 report also confirms its expansion into designed silicon products.
The third batch adds networking and data-center infrastructure companies, reviewed
on 2026-10-13. Each record links its annual filing; suppliers and competitors are
identified by role, without treating an unnamed customer as a confirmed company.
The fourth batch adds LITE, COHR, AMAT and APH on 2026-10-13 using their linked
annual filings; AMAT's named competitor is also supported by Lam Research's filing.

User handoff, 2026-10-13: the user's 22-stock monitoring list replaces ORCL and
DELL with ALAB and LITE. Treat that as the user's current editorial priority.
This change records the instruction and adds company introductions only; it does
not alter Claude-owned news acquisition, translation or delivery configuration.
This is not full-directory coverage. Uncovered
issuers retain their existing approved annual-brief behavior; no generic or
automatically generated introduction is substituted. No automatic research or
update job has been enabled.

Records live in `lib/research/company-introductions.data.json`; the typed server
registry and CIK index live in `lib/research/company-introductions.ts`. The profile API selects
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


## Relationship maps and bulk additions (2026-10-13)

The first four answers are compact cards. Weaknesses are now #4; competition is
#5 and relationships are #6. Both maps use one responsive component across all
23 issuers, with a central company, branches, prominent ticker links and a
localized relationship label. Links run a stock search rather than assuming an
exchange/CIK for an external ticker. Non-US companies, private companies and
industry groups without a verified US ticker are shown without a stock link.
Supplier/customer labels describe the relationship from the central company's
perspective. The line itself does not imply money flow or ownership.

Each map entry stores kind (company/industry), name, optional nameJa/ticker,
role, bilingual label and sourceIndexes into that issuer's primary-source list.
The existing researched prose remains available under Context & sources. These
maps reorganize the existing cited facts; unnamed customers remain industry
groups, not guessed named-company connections. Competitor coverage is illustrative,
not exhaustive. Do not infer that all products compete or that a supplier is a
subsidiary. Annual-report relationships must be reviewed as sources change.

Adding an issuer no longer requires touching UI or TypeScript records. Prepare a
JSON array of complete records using existing data records as the format, then:

```sh
node --experimental-strip-types scripts/research/import-company-introductions.mjs batch.json
node --experimental-strip-types scripts/research/import-company-introductions.mjs batch.json --apply
```

The first command validates only. The second atomically upserts by CIK, preserving
unrelated issuers. Both reject missing translations, missing relation evidence,
invalid source indexes, duplicate identities/map nodes, self-links and older
review dates. CI uses the same validator. Primary-source quality and the factual
meaning of each relationship still require review; URL/schema validation alone
cannot establish a fact.

Scaling workflow: official documents -> batches of structured bilingual drafts ->
source/issuer review -> validation and bulk import -> the normal preview gates.
This release implements the shared renderer and batch import, not an unattended
AI research job or full-directory coverage. Never present automatic collection,
AI generation, update scheduling or all-company completion as already enabled.
The monitored-news list and Claude-owned pipelines are unchanged.
