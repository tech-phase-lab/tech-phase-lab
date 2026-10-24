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

### Theme refinements after user review

- AAOI, LITE, COHR and POET: 光・フォトニクス / Optics & Photonics. Sample AAOI uses the same wording.
- AEHR: 半導体検査装置 / Semiconductor test equipment. Silicon photonics is an application of its semiconductor test/burn-in systems; the coarse SIC major-group fallback was misleading here.
- MSTR and CAN: クリプト / Crypto. Strategy is a Bitcoin treasury company; Canaan supplies Bitcoin mining systems and operates mining activities.
- These labels are watchlist investment themes, not a change to the official SIC or news/monitoring registry.
- Sources: https://www.aehr.com/2026/07/aehr-receives-follow-on-production-order-from-lead-silicon-photonics-customer-for-fully-automated-fox-xp-wafer-level-burn-in-system/ ; https://www.strategy.com/investor-relations ; https://canaan.gcs-web.com/

### Crypto-related label expansion

- User-approved label: クリプト関連 / Crypto-related, covering MSTR, CAN, COIN, HUT and CRCL.
- COIN provides crypto trading/custody infrastructure; HUT includes Bitcoin mining and related infrastructure alongside other compute/energy businesses; CRCL issues stablecoins through regulated affiliates. These are investment themes, not claims that crypto is each issuer's only business.
- A fictional COIN fixture was added to the isolated sample page.
- Sources: https://help.coinbase.com/en/coinbase/getting-started/getting-started-with-coinbase/what-is-coinbase ; https://www.hut8.com/compute ; https://investor.circle.com/overview/

### Crypto coverage review (second pass)

The first pass covered only five tickers and was not a complete crypto universe.
Expanded the watchlist-only theme to 18 reviewed issuers. Display label remains
クリプト関連 / Crypto-related. User-requested BTBT, BTGO, HOOD, RIOT and CLSK
also have explicitly fictional fixtures in the isolated sample.

| Added ticker | Basis | Official source reviewed on 2026-10-08 |
| --- | --- | --- |
| BTBT | ETH treasury and staking, alongside AI infrastructure investments | https://bit-digital.com/ |
| BTGO | Digital asset custody, wallets and trading infrastructure | https://www.bitgo.com/ ; https://www.sec.gov/Archives/edgar/data/1740604/000174060426000050/btgo-20260630.htm |
| HOOD | Crypto brokerage alongside other financial services | https://robinhood.com/us/en/support/robinhood-crypto/ ; https://robinhood.gcs-web.com/ |
| RIOT | Operating Bitcoin mining business alongside data centers | https://www.riotplatforms.com/ |
| CLSK | Bitcoin mining operations alongside AI infrastructure development | https://investors.cleanspark.com/news/news-details/2026/CleanSpark-Releases-August-2026-Operational-Update/ |
| MARA | Bitcoin mining and digital asset infrastructure | https://www.mara.com/about-us |
| HIVE | Bitcoin mining alongside AI/HPC | https://www.hivedigitaltechnologies.com/ |
| BTDR | Bitcoin mining services and mining hardware | https://www.bitdeer.com/ |
| GLXY | Digital asset financial services and onchain infrastructure | https://www.galaxy.com/ |
| GEMI | Crypto exchange and related services | https://investors.gemini.com/ |
| BLSH | Institutional crypto exchange | https://www.bullish.com/ |
| CNCK | Crypto exchange and digital asset infrastructure | https://www.coincheckgroup.com/company-information |
| BMNR | ETH treasury and staking | https://www.sec.gov/Archives/edgar/data/1829311/000149315226030428/ex99-1.htm |

The existing five are MSTR, CAN, COIN, HUT and CRCL. A theme does not imply an
exclusive business. HOOD is not a pure-play crypto company. No blanket matching
on exchange, SIC, company-name keywords or a third-party list: GS/IBM remain
on their existing classifications, and IREN retains its reviewed AI-cloud theme.
This is a reviewed expansion, not a claim that every crypto-related listed
company worldwide is covered. News/price-target registry and pipelines unchanged.
