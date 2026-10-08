# Watchlist classification review — 2026-10-08

Scope: watchlist display and its isolated sample. No news/price-target or monitoring registry changes.

## Policy and immediate correction

These badges represent Tech Phase investment themes, not an official exchange/GICS classification. Semiconductor implementation alone is not enough to put a connectivity company in the broad semiconductor bucket. The user's selected theme for ALAB is Networking, consistent with existing MRVL, CRDO and ANET.

- ALAB: 半導体 / Semiconductors → ネットワーク / Networking.
- Sample MRVL and CRDO: 半導体 / Chips → ネットワーク / Networking (matching the normal page).
- Unknown SEC-search issuers: no badge. Exchange names are never industry labels.
- Regression check compares networking sample labels with the existing registry; no registry mutation.

Evidence reviewed:
- Astera Labs: https://www.asteralabs.com/about/
- Marvell: https://www.marvell.com/products.html
- Credo: https://credosemi.com/about-credo/

## Inventory from current code (22 registered issuers plus ALAB)

| Current normal-page label | Tickers |
| --- | --- |
| 半導体 / Semiconductors | MU, SKHY, SNDK, NVDA, AMD, AVGO, ARM, TSM, ASML |
| ネットワーク / Networking | MRVL, ANET, CRDO, ALAB |
| AIクラウド / AI cloud | NBIS, CRWV |
| 電力・冷却 / Power & cooling | VRT, GEV, BE |
| サーバー / Servers | DELL |
| AIソフトウェア / AI software | PLTR |
| 大手クラウド / Large cloud platforms | MSFT, GOOGL, ORCL |

This inventory verifies configured labels, not a fresh fundamental review of every issuer.

## Earlier classification findings (resolved/extended below)

- MU: normal 半導体 vs sample メモリ. The sample's finer label is supported by Micron's business; decide a common display taxonomy before changing the wider group.
- SKHY/SNDK also remain under the broad semiconductor label.
- ASML could use 半導体製造装置 rather than broad 半導体.
- TSM could use 半導体受託製造 rather than broad 半導体.
- AVGO has multiple business areas; do not move it to Networking solely because ALAB was moved.
- Power/cooling and large-cloud group labels also combine businesses; no automatic relabeling.
- Other searchable stocks, including LITE, do not yet have reviewed watchlist classifications.

Sources for proposed finer distinctions:
- Micron memory/storage: https://www.micron.com/about/company/corporate-profile
- Sandisk flash/storage: https://www.sandisk.com/ja-jp/product-portfolio
- ASML lithography: https://www.asml.com/en/company
- TSMC foundry: https://www.tsmc.com/english/dedicatedFoundry

Do not describe this as all searchable stocks classified or all issuer business classifications verified. Full taxonomy expansion requires agreement on labels and issuer-by-issuer evidence.

## Coverage extension requested by user

User assigned APH to Networking and AAOI to 光フォトニクス. The watchlist now prioritizes its reviewed ticker themes, then existing registered labels, then the issuer's SEC SIC classification from the existing stock-profile API.

New/finer themes:
- APH: Networking — https://www.amphenol.com/products/connectors
- AAOI: Photonics — https://ao-inc.com/products/optical-transceivers/
- LITE: Photonics — https://www.lumentum.com/en/products
- COHR: Photonics — https://www.coherent.com/company/about-us
- POET: Photonics — https://www.poet-technologies.com/about-us
- MU/SKHY/SNDK: Memory (resolves the normal/sample MU discrepancy).
- SKHY source: https://news.skhynix.com/en/q2-2026-business-results/
- ASML/AMAT: Chip equipment. AMAT source: https://www.appliedmaterials.com/us/en/semiconductor/products.html
- TSM: Chip foundry.
- IREN: AI cloud — https://iren.gcs-web.com/news-releases/news-release-details/iren-reports-fy26-results

The semiconductor foundry/equipment/memory distinctions proposed earlier are now applied only to watchlist display. Earlier broad-label inventory is historical. No news registry or API changes.

SIC fallback:
- Existing /api/research/stocks?ticker= endpoint returns the issuer's SIC.
- Active-list missing labels resolve sequentially; abort on list change/unmount, 12-second request timeout, in-memory caching, retries on focus/online/visibility after a failure cooldown.
- Require matching ticker, ok:true, a string SIC code and a recognized SIC major group.
- Translate official SIC major groups into short bilingual labels; selected specific codes get more precise labels. This is an industry fallback, not a claim that every issuer's investment theme has been editorially reviewed.
- The badge title includes the SIC code and original description for fallback labels.
- 0000, unclassified/999x, unavailable or invalid responses stay without a fabricated label.
- Source: https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list
- Major groups: https://www.osha.gov/data/sic-manual
- No claim of 100% coverage: ETFs, issuers without useful SIC, SEC outages and unsupported listings can still lack a label.

### Runtime verification follow-up

- APH and AAOI labels were verified in the deployed normal watchlist and the sample.
- JPM exposed an existing profile-fetch limit: its SEC submission JSON was 4,633,146 bytes and the API rejected it at 2 MB.
- Submission profiles now have a separate 10 MB bound; the directory remains limited to 2 MB. The parsed response remains bounded by the existing profile parser.
- A route test exercises a 4.6 MB profile, an oversized 10 MB profile, and an oversized 2 MB directory.
