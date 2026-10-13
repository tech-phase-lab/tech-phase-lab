# Six-part stock introductions

The stock-search price panel now includes six editorial answers in Japanese and
English: 何の会社？ / どこで稼ぐ？ / 何が強い？ / 弱点は？ / 競合は？ / どこと繋がる？.

The scope is every searchable issuer, independent of the monitored-news universe.
Researched coverage is one hundred seven issuers / one hundred eight tickers:
LITE, COHR, AMAT, APH, ANET, MRVL, VRT, ALAB, MSFT, NBIS, TSM, ASML, AVGO,
AMD, ARM, CRDO, NVDA, MU, GOOG, GOOGL, AAPL, AMZN, META, COST, INTC, SIMO,
AAOI, BE, VST, GEV, IREN, LRCX, KLAC, SMCI, CSCO, HPE, CRWV, ORCL, DELL,
ETN, PANW, CRWD, PLTR, SNOW, QCOM, CRM, NOW, IBM, TXN, ADI, NXPI, MCHP,
MPWR, ON, WDC, STX, HPQ, JBL, CDNS, SNPS, CIEN, KEYS, FLEX, FTNT, ZS, NET,
DDOG, MDB, ADBE, INTU, UBER, NFLX, AKAM, OKTA, S, CHKP, TEAM, TWLO, DOCU,
HUBS, SHOP, APP, ABNB, SPOT, RDDT, PINS, SNAP, RBLX, ROKU, TTD, DASH, MELI,
PYPL, XYZ, SOFI, DUOL, ONTO, TER, ENTG, ACMR, ICHR, UCTT, MKSI, SWKS, QRVO,
MTSI, POWI and SITM.
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
and relationships are #6. Each stock page keeps its own company as the fixed
center. Company nodes and competitor chips are labels, not navigation or selection
controls. Removed local history, Back/Reset, sticky toolbar and the detail toggle
after user feedback. Short direct-relationship descriptions are visible below the
map, with sources in one collapsed section. Colors have stronger contrast and the
page company's node is white to distinguish it from orange recipients.

Direct / 2 steps / All change the visible connections. Direct suppliers and
platform adopters, recipients, collaboration/investment, indirect connections and
competitors have distinct colors; competitors also have dashed outlines. Rivalry
is never traversed as a supply-chain bridge. Further paths do not imply a direct
transaction between their endpoints. Evidence is available in the expandable
fixed-company relationship list, including the original source-company perspective.

`company-network.server.ts` merges cited map records by company identity and
relationship direction, normalizes Google share classes and merges reverse
references. It adds primary-source-checked equipment -> TSMC -> chip -> server /
cloud paths. These include TSMC supplier awards, Applied Materials EPIC, and
NVIDIA/platform providers' deployment announcements. Product adoption is not
presented as proof of a direct purchasing contract. Additional sources and review
dates are attached to each edge. Some companies can have both competition and
collaboration relationships; these remain separate.

Named-company connected components are returned to the client. Unnamed industry
buckets never connect unrelated issuers. Each company also retains its own scoped industry relationships, including when
named connections are present. A layer is a layout
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

### 2026-10-13 マップ表示調整

- 表示範囲の切り替えを見出し右側に移動し、高さを縮小。凡例の上下余白を均等化。
- 競合の区切り線を紫に統一。スマートフォンの競合ラベルは折り返さず、NVDAの5社を1列に表示する。件数が多い場合は行内スクロール。
- 銘柄コードと会社名が同じ場合も、マップの会社名を下段に表示する。閲覧中の企業を固定する仕様と直接関係の説明は維持。

### 2026-10-14 カードの統一と余白

- コードを持つ企業はコードと社名、未登録の企業は社名と既存の事業区分で、全カードに主表示と補助表示を設ける。未登録の銘柄コードは推測しない。
- カードはタップ・キーボード操作で420msだけ軽く光る。企業の切り替えやページ移動は行わない。
- 最後の1社だけの「その他」区分とマップ下端の余白を縮小。SoftBankの既存の関係データは保持する。
- 「06 どこと繋がる？」の上に水色のラインを追加し、番号も同色にする。

### 2026-10-14 最終表示調整

- 「企業を知る」右側の会社名を削除し、閲覧中の企業名の重複を減らす。
- 「06」上の水色ラインは撤去。番号の水色は維持し、競合の紫の区切りだけを残す。
- タップの発光を枠線中心からカード面全体の柔らかな光に変更。180msで明るくなり、タップから620ms後に480msかけて消える。動きを減らす設定では遷移を止める。


### 2026-10-14 未対応の監視銘柄を7社追加

- INTC / SIMO / AAOI / BE / VST / GEV / IRENを追加。合計30社・31銘柄コード。
- 6項目を日英で収録し、競合と取引関係は年次開示・企業公式発表に紐付けた。画面の共通形式、固定する企業、タップ発光を維持。
- VST→Metaは契約済み・2026年末開始予定として区別。IREN→MicrosoftはHorizon 1の受入済み分を区別。採用・共同開発を無条件の購入契約と扱わない。
- 実名リンクと業種単位の競合が併存しても、対象企業自身の業種情報を落とさない。他社の匿名顧客・業種から繋がりを作らない。
- 新規企業の配置を半導体・光通信・電源・クラウドの既存区分に対応付けた。
- 05/06の左位置を共通化し、06上の薄いグレー線を復元済み（104a939）。
- ニュースの監視設定や取得・翻訳・配信、RESOLUTEは変更していない。全社収録や自動更新は未実装。

### 2026-10-14 製造装置・検査の2社追加

- LRCX / KLACを追加。合計32社・33銘柄コード。日英6項目と競合・顧客マップを各社のFY2026 Form 10-Kで確認。
- Lam Researchは成膜・エッチング・洗浄、KLAは欠陥検査・測定を初見でも区別できる説明にした。
- LamのTSMC / Micron / Samsung / SK hynixへの供給、KLAのTSMCへの供給を明示。競合は競合線として維持し、取引先へ変換しない。
- 新しい検査・装置企業は製造装置の段に配置。東京エレクトロンに米国株TEL（TE Connectivity）を割り当てない。
- 公式年次資料のBusiness / Products / Customers / Competition / Risk factorsを照合。主な顧客と競合の例であり全取引先の網羅ではない。
- 既存UI、ニュース、RESOLUTEは変更なし。次回は未収録のCRWV / SMCI / CSCOなど既存マップの企業を一次資料から追加候補として確認する。
- チャット側で継続作業の予約を設定済み。アプリ内に無人の情報収集・更新パイプラインを実装した意味ではない。

### 2026-10-14 サーバー・クラウド・セキュリティ・業務ソフト15社追加

- SMCI / CSCO / HPE / CRWV / ORCL / DELL / ETN / PANW / CRWD / PLTR / SNOW / QCOM / CRM / NOW / IBMを追加。合計47社・48銘柄コード。
- 各社の最新Form 10-Kを一次資料として、日英6項目、競合、供給元・顧客・提携先を一括確認。実名が年次報告で確認できない関係は企業名を推測せず、業種単位で収録した。
- CoreWeaveはMicrosoftへの2025年売上集中、Meta・OpenAIの契約、NVIDIA基盤を区別。SnowflakeはAWS / Azure / Google Cloudが供給元である一方、競合でもあることを別の関係として表示する。
- Palo Alto Networksのクラウド市場、CrowdStrikeのAWS / Google / Microsoft市場、ServiceNowとIBMの戦略提携を、競争関係と混同しない独立した線で収録した。
- QualcommのApple / Samsung / XiaomiはFY2025に各10%以上を占める開示済み顧客として扱う。匿名顧客を実名へ置き換えていない。
- QCOMを半導体設計、PLTR / SNOW / CRM / NOW / IBMをクラウド・AIサービスの配置へ追加。既存の共通UI、ニュース、目標株価、翻訳、RESOLUTEは変更していない。

### 2026-10-14 半導体・設計ソフト・ストレージ・製造12社追加

- TXN / ADI / NXPI / MCHP / MPWR / ON / WDC / STX / HPQ / JBL / CDNS / SNPSを追加。合計59社・60銘柄コード。
- 各社の最新Form 10-Kを確認し、日英6項目と競合・取引関係を追加。一次資料は各データレコードの`source`に収録し、内容確認日は2026-10-14。
- TXN / ADI / NXPI / MCHP / MPWR / ONはアナログ、組み込み、電源、車載の違いが分かるように整理。顧客名が開示されない会社では業種単位の関係を使い、実名を推測していない。
- NXPIの主要最終顧客とAvnet、ADIのTSMC製造委託、MCHPのArrow依存、HPQが採用するOS・CPU・GPUは各社の年次資料で確認。競合関係と供給・採用関係を別の線として扱う。
- WDC / STXはHDD事業とクラウド顧客への供給を追加し、NANDを代替技術として区別。CDNS / SNPSはEDA、設計IP、物理解析、顧客内製ツールを分けた。
- JBLは実名非開示の大口顧客を推測せず、AI・クラウド基盤、半導体装置、自動車・医療などの開示済み市場で表示する。
- 公式資料: [TXN](https://www.sec.gov/Archives/edgar/data/97476/000009747626000059/txn-20251231.htm), [ADI](https://www.sec.gov/Archives/edgar/data/6281/000000628125000153/adi-20251101.htm), [NXPI](https://www.sec.gov/Archives/edgar/data/1413447/000141344726000008/nxpi-20251231.htm), [MCHP](https://www.sec.gov/Archives/edgar/data/827054/000082705426000016/mchp-20260331.htm), [MPWR](https://www.sec.gov/Archives/edgar/data/1280452/000143774926006113/mpwr20251231_10k.htm), [ON](https://www.sec.gov/Archives/edgar/data/1097864/000109786426000006/on-20251231.htm), [WDC](https://www.sec.gov/Archives/edgar/data/106040/000162828026057139/wdc-20260703.htm), [STX](https://www.sec.gov/Archives/edgar/data/1137789/000113778926000159/stx-20260703.htm), [HPQ](https://www.sec.gov/Archives/edgar/data/47217/000004721725000071/hpq-20251031.htm), [JBL](https://www.sec.gov/Archives/edgar/data/898293/000162828025045293/jbl-20250831.htm), [CDNS](https://www.sec.gov/Archives/edgar/data/813672/000081367226000016/cdns-20251231.htm), [SNPS](https://www.sec.gov/Archives/edgar/data/883241/000088324125000028/snps-20251031.htm).
- 全検索企業の収録は未完了。次回は既存マップとつながる通信・光学・クラウド関連の未収録企業を優先する。

### 2026-10-14 通信・クラウド・セキュリティ・アプリ12社追加

- CIEN / KEYS / FLEX / FTNT / ZS / NET / DDOG / MDB / ADBE / INTU / UBER / NFLXを追加。合計71社・72銘柄コード。
- 各社の最新Form 10-Kを一次資料として、日英6項目、競合、供給元・顧客・提携先を確認。確認日は2026-10-14。
- Cienaはクラウド・通信事業者・海底回線、Keysightは通信・半導体・自動車・航空宇宙、Flexは受託製造とデータセンター電源を区別した。
- Fortinet / Zscaler / Cloudflareは、ファイアウォール、ゼロトラスト、Web配信・防御の違いが初見でも分かるよう整理。競合関係と販売・運用パートナーを混同していない。
- Datadog / MongoDBは利用量課金とクラウド基盤費を明示。MongoDB AtlasのAWS / Azure / Google Cloud利用は供給・採用元として表示した。
- Adobe / Intuit / Uber / Netflixは、収益源と企業固有のリスクをサービス別に記述。匿名顧客は社名を推測せず業種単位で収録した。
- 公式資料: [CIEN](https://www.sec.gov/Archives/edgar/data/936395/000162828025056698/cien-20251101.htm), [KEYS](https://www.sec.gov/Archives/edgar/data/1601046/000160104625000127/keys-20251031.htm), [FLEX](https://www.sec.gov/Archives/edgar/data/866374/000086637426000012/flex-20260331.htm), [FTNT](https://www.sec.gov/Archives/edgar/data/1262039/000126203926000007/ftnt-20251231.htm), [ZS](https://www.sec.gov/Archives/edgar/data/1713683/000171368326000157/zs-20260731.htm), [NET](https://www.sec.gov/Archives/edgar/data/1477333/000147733326000016/cloud-20251231.htm), [DDOG](https://www.sec.gov/Archives/edgar/data/1561550/000162828026008819/ddog-20251231.htm), [MDB](https://www.sec.gov/Archives/edgar/data/1441816/000162828026016799/mdb-20260131.htm), [ADBE](https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm), [INTU](https://www.sec.gov/Archives/edgar/data/896878/000089687826000037/intu-20260731.htm), [UBER](https://www.sec.gov/Archives/edgar/data/1543151/000154315126000015/uber-20251231.htm), [NFLX](https://www.sec.gov/Archives/edgar/data/1065280/000106528026000034/nflx-20251231.htm).
- 既存UI、ニュース・目標株価・翻訳、RESOLUTEは変更していない。全検索企業の収録は引き続き未完了。

### 2026-10-14 ID・セキュリティ・業務・消費者サービス12社追加

- AKAM / OKTA / S / CHKP / TEAM / TWLO / DOCU / HUBS / SHOP / APP / ABNB / SPOTを追加。合計83社・84銘柄コード。
- 各社の最新Form 10-KまたはForm 20-Fを一次資料として、日英6項目と競合・取引関係を確認。確認日は2026-10-14。
- Akamaiは配信・セキュリティ・クラウド、Oktaは従業員・顧客ID、SentinelOneは端末・クラウド防御、Check Pointは統合セキュリティの違いを明示した。
- Atlassian / Twilio / Docusign / HubSpotは収益源と利用部門を分け、実名顧客が開示されない箇所は企業名を推測せず業種単位で収録した。
- ShopifyはSubscription SolutionsとMerchant Solutions、AppLovinはAxon広告基盤、Airbnbは予約サービス料、Spotifyは有料契約と広告の二本柱を区別した。
- AppLovinのApple / Google依存、Airbnbの決済網、Spotifyの権利者と通信会社は、競争・供給・販売の役割を混同しないよう別の関係として表示する。
- 公式資料: [AKAM](https://www.sec.gov/Archives/edgar/data/1086222/000108622226000022/akam-20251231.htm), [OKTA](https://www.sec.gov/Archives/edgar/data/1660134/000166013426000020/okta-20260131.htm), [S](https://www.sec.gov/Archives/edgar/data/1583708/000158370826000020/s-20260131.htm), [CHKP](https://www.sec.gov/Archives/edgar/data/1015922/000117891326001932/zk2634942.htm), [TEAM](https://www.sec.gov/Archives/edgar/data/1650372/000165037226000036/team-20260630.htm), [TWLO](https://www.sec.gov/Archives/edgar/data/1447669/000144766926000021/twlo-20251231.htm), [DOCU](https://www.sec.gov/Archives/edgar/data/1261333/000126133326000021/docu-20260131.htm), [HUBS](https://www.sec.gov/Archives/edgar/data/1404655/000119312526046646/hubs-20251231.htm), [SHOP](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm), [APP](https://www.sec.gov/Archives/edgar/data/1751008/000175100826000010/app-20251231.htm), [ABNB](https://www.sec.gov/Archives/edgar/data/1559720/000155972026000004/abnb-20251231.htm), [SPOT](https://www.sec.gov/Archives/edgar/data/1639920/000162828026006874/ck0001639920-20251231.htm).
- 既存の共通UI、ニュース・目標株価・翻訳、RESOLUTEは変更していない。全検索企業の収録は引き続き未完了。

### 2026-10-14 消費者プラットフォーム・広告・決済12社追加

- RDDT / PINS / SNAP / RBLX / ROKU / TTD / DASH / MELI / PYPL / XYZ / SOFI / DUOLを追加。合計95社・96銘柄コード。
- 各社の最新Form 10-Kを一次資料として、日英6項目と競合・取引関係を確認。確認日は2026-10-14。
- Reddit / Pinterest / Snapは、コミュニティ、画像探索、カメラ中心の交流という違いを明示。利用時間の競争と広告主・制作者との取引を分けた。
- RobloxはRobuxと制作者分配、Rokuは広告・動画サービス分配・機器、The Trade Deskは広告費連動の基盤利用料を収益源として区別した。
- DoorDashは加盟店・配達員・利用者、MercadoLibreはEC・決済・物流・融資の循環を表示。実名が開示されない加盟店や金融機関は推測していない。
- PayPal / Block / SoFiは、消費者・加盟店・銀行・カード網の役割を整理し、競争関係と決済・清算の供給関係を混同していない。
- Duolingoは契約、広告、英語試験を分け、AI競争とアプリ配信基盤への依存を企業固有のリスクとして収録した。
- 公式資料: [RDDT](https://www.sec.gov/Archives/edgar/data/1713445/000171344526000022/rddt-20251231.htm), [PINS](https://www.sec.gov/Archives/edgar/data/1506293/000150629326000021/pins-20251231.htm), [SNAP](https://www.sec.gov/Archives/edgar/data/1564408/000156440826000013/snap-20251231.htm), [RBLX](https://www.sec.gov/Archives/edgar/data/1315098/000131509826000024/rblx-20251231.htm), [ROKU](https://www.sec.gov/Archives/edgar/data/1428439/000162828026008114/roku-20251231.htm), [TTD](https://www.sec.gov/Archives/edgar/data/1671933/000167193326000014/ttd-20251231.htm), [DASH](https://www.sec.gov/Archives/edgar/data/1792789/000179278926000013/dash-20251231.htm), [MELI](https://www.sec.gov/Archives/edgar/data/1099590/000109959026000006/meli-20251231.htm), [PYPL](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm), [XYZ](https://www.sec.gov/Archives/edgar/data/1512673/000162828026012254/xyz-20251231.htm), [SOFI](https://www.sec.gov/Archives/edgar/data/1818874/000181887426000013/sofi-20251231.htm), [DUOL](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm).
- 既存UI、ニュース・目標株価・翻訳、RESOLUTEは変更していない。全検索企業の収録は継続する。

### 2026-10-14 半導体装置・材料・RF・電源12社追加

- ONTO / TER / ENTG / ACMR / ICHR / UCTT / MKSI / SWKS / QRVO / MTSI / POWI / SITMを追加。合計107社・108銘柄コード。
- 欠陥検査、テスト、材料・汚染管理、洗浄装置、装置サブシステム、RF、光・高周波、電源、MEMSタイミングまで、各社の最新Form 10-Kを一次資料として日英6項目と関係マップを確認した。確認日は2026-10-14。
- 装置・材料会社は半導体メーカーや装置OEMとの供給関係を、RF・電源・タイミング会社は端末・通信・産業機器メーカーとの関係を区別した。実名顧客が開示されていない箇所は会社名を推測せず、業種単位で表示する。
- MTSIのADI / Broadcom / Marvellとの競争、POWIのTI / NXP / onsemiとの競争は各社の年次報告に基づく。競争線を供給関係へ置き換えていない。
- SkyworksとQorvoは年次報告の対象期間と発表済み取引の状態を混同せず、今回のマップでは統合完了を前提にしていない。
- 公式資料: [ONTO](https://www.sec.gov/Archives/edgar/data/704532/000119312526066937/onto-20260103.htm), [TER](https://www.sec.gov/Archives/edgar/data/97210/000119312526059002/ter-20251231.htm), [ENTG](https://www.sec.gov/Archives/edgar/data/1101302/000110130226000012/entg-20251231.htm), [ACMR](https://www.sec.gov/Archives/edgar/data/1680062/000162828026013231/acmr-20251231.htm), [ICHR](https://www.sec.gov/Archives/edgar/data/1652535/000165253526000012/ichr-20251226.htm), [UCTT](https://www.sec.gov/Archives/edgar/data/1275014/000162828026010744/uctt-20251226.htm), [MKSI](https://www.sec.gov/Archives/edgar/data/1049502/000119312526066820/mksi-20251231.htm), [SWKS](https://www.sec.gov/Archives/edgar/data/4127/000000412725000085/swks-20251003.htm), [QRVO](https://www.sec.gov/Archives/edgar/data/1604778/000162828026032873/rfmd-20260328.htm), [MTSI](https://www.sec.gov/Archives/edgar/data/1493594/000149359425000054/mtsi-20251003.htm), [POWI](https://www.sec.gov/Archives/edgar/data/833640/000083364026000037/powi-20251231x10k.htm), [SITM](https://www.sec.gov/Archives/edgar/data/1451809/000145180926000012/sitm-20251231.htm).
- 共通UI、ニュース・目標株価・翻訳、RESOLUTEは変更していない。全検索企業の収録は継続する。
