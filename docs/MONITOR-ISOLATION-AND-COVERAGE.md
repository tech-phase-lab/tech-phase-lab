# 常時監視の分離と22銘柄の取得先整備

更新日: 2026-09-24 UTC。開発用の空環境のみ作成済み。追加の監視サービス起動、契約、通知有効化は未実施。

## 2026-09-24 管理画面で確認した状態

- Railwayの `radiant-magic` プロジェクトに、Empty Environment方式で
  `research-staging` を作成した。既存環境の変数・データ・サービスは複製していない。
- 新環境にはまだサービス、専用ボリューム、認証情報を設定していない。
  Vercel Previewの接続先も切り替えていないため、分離完了・常時監視開始とは扱わない。
- 既存 `research-monitor` はOnline、`/Dockerfile.research-monitor`、
  `codex/research-preview` からの自動デプロイが有効。
  保存ボリュームが接続され、ヘルスチェックは `/health`。
  既存サービスの設定・保存データは変更していない。
- 別サービス `tech-phase-lab` もOnline。接続ブランチは `main`、自動デプロイは無効。
  このサービスの設定も変更していない。
- ワークスペースは **Limited Trial**。画面上の残枠は **26日または$3.36**。
  料金画面にはネットワーク制限と、GitHub連携または支払方法追加による解除案内がある。
  ソースリポジトリが接続済みでも、制限解除済みとは判断しない。
- 料金画面ではHobbyは月額最低$5（同額の利用クレジットを含む）、超過分は従量課金。
  契約・支払方法の追加はしていない。新しい常時運転の前に通信条件と予算を確認する。
- 他チャットのリモート更新 `aaf5544` をローカルへマージし、Pythonの全テストと
  JavaScriptの94テストが成功。追加実装は未push。既存サービスへの自動デプロイを
  解消し、新環境の起動条件を整えてから反映する。

管理画面での実測状態であり、料金・残枠は固定保証ではない。

### 追加の取得確認と点検コマンド

- Micron公式ブログ `https://www.micron.com/about/blog` はHTMLを取得できたが、
  記事リンクは0件。公開HTMLには動的な記事一覧の取得先が記載されている。
  汎用HTML一覧監視に登録するだけでは取得できないため、未対応として扱う。
  公開JavaScriptの再取得ではHTTP 503も発生した。繰り返し取得は行わず、
  ブログ専用取得方式の検証を残す。既存の公式ニュース・SEC監視とは別の不足項目。
- `python scripts/research/coverage_report.py` で22銘柄の登録台帳と補完元の不足を
  点検できる。既存DBを `--db` で指定すると補完元の未取得・取得成功・古い成功記録・
  取得失敗・設定変更を区別する。DBは読取専用。共通記事元があることを全銘柄の
  網羅保証に数えない。公式IR元の稼働判定は別途必要。

## 確認済みと未確認を分ける

- GitHubの `codex/research-preview` のコミット状態にVercelと
  `radiant-magic - research-monitor` の両方のデプロイ成功記録がある。
- 既存Railway監視が会員向け本番か、プレビュー用監視を既定のproduction環境に
  置いたものかは、ステータス名だけでは判定できない。管理画面の接続元・変数・
  データ保存先・利用者を確認する必要がある。
- この台帳はローカル実装の登録状況。到達性・最新性・商用利用許可の保証ではない。
- 他チャットによるリモート更新があるため、反映前に差分を統合し、force pushしない。

## 推奨する構成と作業順

1. 既存Railwayサービスの環境、接続ブランチ、稼働コミット、保存ボリューム、
   APIの利用先、費用を読み取り確認する。APIキーの値は記録しない。
2. プレビューブランチをpushする前に、既存サービスへの自動デプロイ連動を解消。
   既存稼働コミットを保つ専用ブランチへの接続切替、または自動デプロイ停止を候補とする。
   設定変更で再デプロイされるか事前に確認し、既存環境への変更は明示承認後に実行する。
   mainを変更・本番へ昇格する必要はない。
3. Railwayに空の永続環境 `research-staging` と専用サービス
   `research-monitor-staging` を用意する。productionの設定を丸ごと複製しない。
   ブランチは `codex/research-preview`、Dockerfileは既存の
   `Dockerfile.research-monitor`、起動は `python scripts/research/service.py`。
4. 専用の空ボリュームを `/data` にマウントし、APIトークン・編集トークンも新規発行。
   稼働レプリカはまず1台、スリープは無効。データ・認証情報は他環境と共有しない。
   バックアップの取得だけでなく、別のテスト用DBへの復元も検証する。
5. Vercelでは `codex/research-preview` 向けのPreview環境変数だけを変更し、
   新しい監視サービスに接続。Production側の接続先・変数は変更しない。
6. 22銘柄の基準データを取得後、短いスモークテスト、24時間の継続監視、再起動テスト。
   取得失敗・取得待ち・停止を正常なニュース0件と区別し、画面までの経路を確認する。
   合格後も数秒の速報保証はせず、公表時刻が正確な資料で実測する。

追加環境には計算資源・保存容量の費用が発生し得る。既存契約の残枠、実測使用量、
利用上限の扱いを確認してから起動する。予算通知をハードな課金停止と混同しない。

### 設定の対応表（値は案。秘密値は含めない）

| 設定先 | 設定 | 値／意味 |
|---|---|---|
| 新Railwayサービス | RESEARCH_DATA_DIR | /data |
| 新Railwayサービス | RESEARCH_SIGNALS_ENABLED | 1：今回の補完監視 |
| 新Railwayサービス | RESEARCH_AUTO_DRAFTS | 0：有料AI呼び出し停止 |
| 新Railwayサービス | RESEARCH_INCIDENT_DELIVERY_ENABLED | 0：外部通知停止 |
| 新Railwayサービス | RESEARCH_API_TOKEN | 新規の読取用秘密値 |
| 新Railwayサービス | RESEARCH_EDITOR_TOKEN | 上記とは別の新規編集用秘密値 |
| 新Railwayサービス | OPENAI_API_KEY・通知Webhook等 | 初期は設定しない |
| Vercel Preview（対象ブランチ限定） | RESEARCH_MONITOR_URL | 新サービスのHTTPS URL |
| Vercel Preview（対象ブランチ限定） | RESEARCH_MONITOR_TOKEN | 新RailwayのAPIトークンに対応 |

編集用トークンは既存の編集画面から入力する方式。公開JSやNEXT_PUBLIC変数に置かない。
既存のIR監視は3〜5秒の設定、補完元は60〜120秒の設定、Anthropic個別本文の
再確認は1時間である。取得間隔と公表からの到着時間は異なる。先方の制限・
失敗時の待ち時間・処理時間に応じて延びるため、負荷と鮮度を両方計測する。

## 22銘柄の設定台帳

公式取得先の登録は22/22。今回の補完モジュールに銘柄を固定した追加元があるのは
SKHY、NBIS、NVDA、MSFTの4銘柄。これは既存取得元が扱う製品記事を含めた
全体の網羅率ではない。共通元のSemiAnalysisとAnthropicは全22銘柄へ本文照合し、
特定銘柄のニュースとして無条件には配信しない。

「次に検証する情報」は調査対象。取引関係や取得可能性が確認済みという意味ではない。

| 銘柄 | 登録済み公式取得先 | 今回の銘柄固定の補完元 | 次に検証する情報 |
|---|---|---|---|
| MU | [Micron](https://www.micron.com/about/press/news) | 未登録 | HBM・DRAM製品ブログ／顧客の採用発表 |
| SKHY | [SK hynix](https://news.skhynix.com/en/category/ir/) | SK hynix Newsroom | HBM・製造技術／韓国語の公式発表 |
| SNDK | [Sandisk](https://investor.sandisk.com/news-events/news-releases) | 未登録 | NAND・SSD製品発表／決算資料 |
| NBIS | [Nebius](https://nebius.com/newsroom) | Nebius · Preemptible VMs、Nebius · Product changelog | 製品仕様・価格・障害／顧客・提携先／外部GPUクラウド評価 |
| NVDA | [NVIDIA](https://nvidianews.nvidia.com/rss.xml) | NVIDIA Developer Blog | 開発者情報／新製品の採用先・システム構成 |
| AMD | [AMD](https://ir.amd.com/news-events/press-releases/rss) | 未登録 | Instinct・EPYC製品情報／クラウド採用 |
| AVGO | [Broadcom](https://investors.broadcom.com/financial-information/financial-news-releases) | 未登録 | ネットワーク・カスタム半導体の製品情報／顧客側発表 |
| ARM | [Arm](https://newsroom.arm.com/news/feed/) | 未登録 | 設計・ライセンス・エコシステム発表 |
| TSM | [TSMC](https://pr.tsmc.com/english/news) | 未登録 | 先端プロセス・先端パッケージ／台湾の公式開示 |
| ASML | [ASML](https://www.asml.com/en/news/press-releases) | 未登録 | 露光装置・技術情報／受注・輸出規制の公式資料 |
| MRVL | [Marvell](https://investor.marvell.com/news-events/press-releases/rss) | 未登録 | 光・ネットワーク・カスタム半導体の製品情報 |
| ANET | [Arista Networks](https://www.arista.com/en/company/news/press-release-rss) | 未登録 | ネットワーク製品・技術ブログ／導入事例 |
| CRDO | [Credo](https://credosemi.com/) | 未登録 | 高速接続・AEC製品／採用発表 |
| CRWV | [CoreWeave](https://www.coreweave.com/) | 未登録 | クラウド製品・価格・障害／顧客側発表 |
| VRT | [Vertiv](https://www.vertiv.com/en-us/about/news-and-events/corporate-news/) | 未登録 | 冷却・電源製品／データセンター導入事例 |
| GEV | [GE Vernova](https://www.gevernova.com/news/subscribe/all/rss.xml) | 未登録 | 発電設備・受注・納入計画 |
| DELL | [Dell Technologies](https://investors.delltechnologies.com/news-events/press-release) | 未登録 | AIサーバー製品／構成・導入事例 |
| PLTR | [Palantir](https://www.palantir.com/sitemap.xml) | 未登録 | 製品・顧客事例／提携先の公式発表 |
| MSFT | [Microsoft](https://news.microsoft.com/source/feed/) | Microsoft Blog | Azureの製品・設備投資／顧客・供給側発表 |
| BE | [Bloom Energy](https://investor.bloomenergy.com/rss/pressrelease.aspx) | 未登録 | 発電設備・受注／導入企業の公式発表 |
| GOOGL | [Alphabet / Google](https://blog.google/rss/) | 未登録 | Cloud・TPU・データセンターの製品・技術情報 |
| ORCL | [Oracle](https://www.oracle.com/news/) | 未登録 | OCI製品・設備／顧客・提携先発表 |

各追加元は、URLの登録だけで完了にしない。以下を記録する。

- 発信主体、情報種別、対応銘柄、関連付けの根拠URLと確認日。
- 取得方式・間隔、直近成功時刻、本文抽出結果、失敗原因、予備経路。
- 新規記事、銘柄名のないタイトル、同一URL更新、訂正の検証例。
- 利用条件、要約・引用・保存・公開の可否。一般公開されているだけで許可済みとしない。

優先順はNBIS/MU → 同分野の半導体・AIクラウド → ネットワーク → 電力・設備。
残り銘柄も台帳から外さず、全銘柄の未検証項目を一覧で残す。過去記事での
仕組み確認と、新着を実際に検出した実績は別々に記録する。

## 参照した公式資料

- https://docs.railway.com/environments
- https://docs.railway.com/guides/isolate-staging-production
- https://docs.railway.com/deployments/serverless
- https://vercel.com/docs/environment-variables
