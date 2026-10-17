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

## 2026-10-12 compact metrics and ETF chart follow-up

- Keep date and 時点 inline on phones; reduce metric strip padding.
- Move stock lookup / ETF comparison to independent header buttons alongside CAPITAL MAP. Category tabs retain managers / companies / ETF.
- Remove chart explanatory captions; keep a gray Other key below the ring.
- ETF charts show the top 30 positions without renormalization (SPY: 55.99%, remainder 44.01%). Smaller wedges from 1.2% get radial ticker labels; every wedge supports pointer, touch and keyboard inspection in the center. Manager charts retain the top ten.

## 2026-10-12 mobile search and global-equity comparison

- Reduced metric strip padding and line heights; date and 時点 stay on one line.
- Stock lookup renamed この株を持つのは？. Holder-first results show manager/company/ETF, portfolio weight, value and as-of date. Common Japanese stock aliases supported. Watchlist filter is a compact checkbox.
- Mobile text inputs and selects use at least 16 px to prevent iOS input-focus zoom; no viewport zoom restrictions were added.
- Added a separately reviewed full ACWI equity snapshot (2,197 positions, 2026-10-09; official iShares CSV; issuer-rounded weights total 98.95%, not renormalized). Import with scripts/capital-map/import-acwi.py. Original source URL and SHA-256 retained. Existing snapshots unchanged.
- ACWI equities on NYSE/NASDAQ match known US ETF security IDs; other exchanges are namespaced to avoid ticker collisions / ADR conflation. BRK B is normalized to BRK.B only for a US listing. Regression check ensures Taiwan 2330 does not match the TSM ADR.
- Compare defaults to S&P500 (SPY) + global equities (ACWI). Japanese labels prioritize investment scope. ACWI is explicitly identified as a US ETF, not the Japanese オルカン mutual fund.
- ACWI remains behind the existing server membership gate; the public sample remains fictional.
- Official product: https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf ; Japanese オルカン benchmark reference: https://faq1.am.mufg.jp/answer/66a3524c5c9109532c1f941e/

### 2026-10-12 ナビゲーションと文言の微調整
- 基準日のラベルと値の間を2px広げ、帯の薄さは維持。
- 「銘柄から検索」「ETF比較」をカテゴリ切り替えと同じ段に移動。狭い画面は折り返す。
- 検索見出しを「検索した株を持つ運用会社・ETFを探す」に変更し、例示ボタンを削除。

### 2026-10-12 日付とETF比較の表示修正
- スマホの日付だけ小さくする指定を外し、他の指標と同じ1remに統一。日付列の幅を調整。
- 日本語はS&P500、全世界株式などに短縮。セクターETFはティッカーと分野で表示し、「半導体株」表記を廃止。英語はティッカーのみ。
- 比較セレクトは縮小可能なグリッドとborder-boxで枠内に収め、英語の長いラベルも折り返す。

### 2026-10-12 検索見出しと運用会社マーク
- 検索見出しを「この銘柄を保有する運用会社・ETFを探す」に変更。
- 写真がないCoatue、Tiger Global、Viking、Fundsmithに色分けした会社イニシャルの装飾マークを追加。公式ロゴや人物の似顔絵ではない独自のUI装飾。
- 写真読込失敗時もイニシャルを表示して、人物紹介の配置を維持。

### 2026-10-12 企業の追加
- Amazon、Intel、Ciscoを追加し、企業カテゴリを2社から5社に拡充。通常ページの既存PRO認証後に読み込み、サンプルの架空データは維持。
- 3社とも2026-06-30のSEC 13F-HR全文を表紙の件数・評価額合計と照合。Amazonは6明細/$4,423,057,466、Intelは3明細/$620,621,529、Ciscoは6明細/$405,215,728。
- Intelの同一CUSIP・同一商品に対する2運用主体のJoby明細は合算して2銘柄表示。CiscoのITOT・IVVも除外せずETF名で収録。13F対象資産であり、非公開株を含む全投資資産ではない。
- 原本URLとSHA-256をcapital-map-corporate.jsonに記録。ローカル原本からscripts/capital-map/import-corporate.pyで再生成可能。ティッカーはSEC company_tickers.json、ITOT/IVVはiShares公式商品ページ239724/239726で確認。
- 過去四半期は未収録のため前回差分は未確認表示を維持。

### 2026-10-12 前期比較の追加
- 8運用会社・5企業の2026-03-31 SEC 13F-HRを追加。2026-06-30との差を株数で比較し、新規・増加・減少・変化なし・保有解消を既存一覧に表示。ETFの過去データは今回の対象外。
- 13社すべて表紙のCIK・四半期・明細件数・評価額合計と照合。同一CUSIP/商品区分の明細を合算し、stock/put/callは別扱い。株式分割等の調整は行わず、売買量と同一視しない旨を「データについて」に記載。
- 原本URL・表紙URL・SHA-256をcapital-map-history.jsonに保存。scripts/capital-map/import-history.pyでローカル原本から再生成。履歴は通常ページのPRO認証後のみ読み込み、公開サンプルは変更なし。
- Intelは前期もJOBY 15,316,315株、MBLY 50,000,000株。評価額の増加だけで買い増し表示にならないことを検証。
- 全保有銘柄を描画済みでも浮動小数点誤差で出ていた「その他 <0.01%」を抑制。

### 2026-10-12 保有詳細と一覧の整理
- 一覧検索は虫眼鏡ボタンで開閉。スマホ入力は16px以上を維持。
- 現在保有と保有解消を上部の件数付きボタンで切り替える。解消銘柄は現在保有の末尾に混在させない。
- 銘柄リンクから専用URLの保有詳細画面へ移動。株式区分・正確な評価額・比較前後の株数・増減株数・増減率・開示リンクを表示。未収録とゼロを区別。
- Next.jsのnative history連携で一覧を保持し、戻るボタン／ブラウザの戻るで検索・カテゴリ・表示件数・内側とページのスクロール位置を復元。URLを直接開いた場合も該当保有者の一覧へ戻れる。通常ページの認証とサンプル分離を維持。
- 株数の比較列は前期比へ短縮し、比較基準日から今回基準日までを併記。前回確認基準のときは専用表記。

### 2026-10-12 スマホのナビゲーションと比較の文言
- スマホでは5つのナビゲーションを折り返さず、文字と左右余白を縮める。英語のツール名もStock search / ETF compareに短縮。
- button共通のfont:inheritが個別の文字サイズを上書きする指定を除去。
- 比較先を「前期の開示」「確認済みの開示」と明示し、チェック欄を「株数が変わった銘柄のみ」へ変更。比較元がないときは絞り込みを無効化し、空の一覧になるのを防止。
- 確認ボタンも「この開示を確認済みにする」へ変更。日付は選択中のsnapshot.asOfに連動。自動取得ジョブは未実装で、データ更新自体は別工程。

### 2026-10-12 comparison simplification
- Comparison is always the prior disclosure, headed 前期からの変化. Removed the saved-disclosure selector and manual acknowledgement buttons.
- NEW beside the as-of label appears when a previously opened portfolio has a different snapshot ID in this browser. First visits are not marked new. Opening automatically records the snapshot; the badge stays during this page session and clears on reload. No blinking. Storage failures do not block holdings.
- Phone category tabs have wider gaps and touch areas while keeping the tools on the same row.

### 2026-10-12 comparison panel readability
- Framed the prior-period comparison in a subtle violet panel, with heading above dates and the current date emphasized. Each date stays intact when wrapping. Increased checkbox size and kept the whole label clickable.

### 2026-10-12: Corporate CEO profiles

- Added bilingual CEO names, roles and face photographs for all five corporate portfolios: NVIDIA, Google, Amazon, Intel and Cisco. Current roles were checked against each company's official biography or leadership page; those links and the photo credits/licenses appear in the existing source details.
- Corporate selector/display name is now `Google`. The portfolio identifier remains `alphabet-13f`; its short description identifies Alphabet as the filing parent. Securities and disclosure holdings are unchanged.
- Reuses the existing compact portrait/profile layout and image-error fallback. Original portrait compositions were visually checked; no generated likenesses are used.

### 2026-10-13: Compact profile descriptions

- Shortened all 13 manager/corporate descriptions in Japanese and English to single-line copy at ordinary mobile widths. Uses 「テック企業」 where applicable; no font reduction or ellipsis. Disclosure sources still identify the filing entity.

### 2026-10-13: Distinct corporate copy

- Reworded each of the five corporate descriptions around its business, avoiding repeated 「テック企業」 endings while keeping short Japanese/English copy.
- Display name remains `Google`. Alphabet is mentioned in the description: `Alphabet傘下で検索やYouTube、クラウドを展開。` The `alphabet-13f` identifier and holdings are unchanged.
- Next priority: scheduled disclosure/ETF data refresh. Current import scripts consume reviewed local source files; no capital-map scheduled refresh workflow is present.
