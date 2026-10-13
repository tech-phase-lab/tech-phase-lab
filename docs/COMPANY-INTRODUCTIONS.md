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
by both SEC CIK and ticker and returns that issuer's introduction plus its connected
company graph (node summaries and cited edges). Unrelated components are excluded. The client
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

The first four answers are compact cards. Weaknesses are #4; competition is #5
and relationships are #6. The layered network now replaces outbound stock links.
Tapping a company changes selection in place; Back and Reset operate on local
selection history. Switching JA/EN preserves selection. The stock URL and scroll
position are not changed by selection. Business-layer positions remain stable.

Direct / 2 steps / All change the visible connections. Direct suppliers and
platform adopters, recipients, collaboration/investment, indirect connections and
competitors have distinct colors; competitors also have dashed outlines. Rivalry
is never traversed as a supply-chain bridge. Further paths do not imply a direct
transaction between their endpoints. Evidence is available in the expandable
selected-company inspector, including the original source-company perspective.

`company-network.server.ts` merges cited map records by company identity and
relationship direction, normalizes Google share classes and merges reverse
references. It adds primary-source-checked equipment -> TSMC -> chip -> server /
cloud paths. These include TSMC supplier awards, Applied Materials EPIC, and
NVIDIA/platform providers' deployment announcements. Product adoption is not
presented as proof of a direct purchasing contract. Additional sources and review
dates are attached to each edge. Some companies can have both competition and
collaboration relationships; these remain separate.

Named-company connected components are returned to the client. Unnamed industry
buckets never connect unrelated issuers. A company without a researched named
connection falls back to its own industry relationships. A layer is a layout
category, not a claim that a company only operates in that business.

Each source map entry stores kind (company/industry), name, optional nameJa/ticker,
role, bilingual label and sourceIndexes into that issuer's primary-source list.
The shared responsive renderer in `company-network.tsx` uses this structured graph;
new issuers do not need a hand-drawn diagram. Relationships still require factual
review; competition is illustrative and not exhaustive. No price-impact or buy
prediction is generated from the graph.

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
