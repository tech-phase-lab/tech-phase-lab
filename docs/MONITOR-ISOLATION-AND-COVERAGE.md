# 常時監視の分離と22銘柄の取得先整備

更新日: 2026-09-24 UTC。開発用常駐サービスを起動し、対象Previewへの接続を確認済み。

## 2026-09-24 管理画面と実通信で確認した状態

- Railway `radiant-magic` / `research-staging` に `research-monitor-staging` を起動。
  GitHub `codex/research-preview` の `49c778a` をデプロイし、Onlineを確認した。
- 専用ボリューム `research-monitor-staging-volume` を `/data` に接続。
  読取・編集用キーはそれぞれ新規発行し、既存のデータ・認証情報は複製していない。
- 既存 `research-monitor` は自動デプロイだけを無効化。稼働サービスと保存データを維持。
  別サービス `tech-phase-lab`、GitHub main、Vercel Productionは変更していない。
- スリープ無効、1レプリカ、ヘルスチェック `/livez`。外部通知・有料AIは無効。
- 新サービスURL: https://research-monitor-staging-research-staging.up.railway.app
- VercelのPreview・`codex/research-preview` 限定のURLと読取キーを変更し再デプロイ。
  ブラウザーの `/research/review` で新しい編集キーによる認証と取得キュー表示が成功。
  未認証の `/admin/signals` は401、`/livez` は200。秘密値はこの文書に記録しない。
- 03:09 UTC時点で補完キュー174件を確認。NebiusブログのPlatinum評価・スポット価格記事、
  SemiAnalysisのClusterMAX記事、Anthropic記事がクラウド上で自動取得されている。
  いずれも初回取得の基準データであり、公表時点に検出した実績ではない。
- 22銘柄の公式巡回を確認。03:07 UTCの状態は17銘柄ok、4銘柄fallback、CRDOがdegraded。
  ARM本文の403、DELL/AVGO/SNDKのタイムアウト等は未解消。代替経路の成功と全文取得は別。
- 自動バックアップ初回成功、通知配送0件、有料AI設定なしを `/health` で確認。
  長時間の連続運転と新着の到達速度は、今後の実測が必要。
- RailwayはLimited Trial。起動時の表示は26日または$3.36。契約変更・支払方法追加なし。
  トライアル残枠内で稼働しており、期限後の継続稼働は保証しない。
- 最新の他作業変更 `67038e2` を統合したうえでGitHubアプリから反映。
  ローカルとリモートのツリー一致を確認して同期。force pushなし。

### 更新後の再起動・永続化確認（03:16 UTC）

- `a9c0066` のArista追加が新サービスだけへ自動デプロイされ、Onlineに復帰。
- プロセスの開始時刻は03:16:05へ変わったが、NBISのPlatinum・スポット価格記事は
  初回取得時刻03:05:33のまま保持。初回データの取り直しによる偽の新着は確認されていない。
- 補完監視11経路。Arista RSS10件の取得成功をPreview編集画面で確認。
  Anthropicの個別1記事失敗、CoreWeaveの過去本文82件待ちは残る。
- `/health` はready、22銘柄、再起動後5巡回、バックアップ2件を確認。
- 専用ボリュームの切替中は一時的に502を観測。単一レプリカ・専用ボリュームのため
  更新中も無停止とは扱わない。継続稼働の検証は開始済みだが24時間完了ではない。

### 今回の実装・動作確認

- Nebiusの一覧には通常のHTML記事リンクがないため、公開Next.js記事一覧データを
  指定パスだけ解析する方式を追加。外部ホストへのリンクは拒否する。
- CoreWeave本文の範囲を指定し、関連記事欄による誤った銘柄関連付けを防止。
  PC・スマホ用の重複見出しも1つにする。
- Dell・CoreWeaveの製品/技術ブログを追加。DellのRSS本文とCoreWeaveの個別本文を取得確認。
- Python全191件、JavaScript94件、TypeScriptが成功。リモート統合後はサービス58件も成功。
- 10経路の補完監視では9経路が成功、Anthropicは取得成功記事と個別記事1件の失敗が混在。
  取得待ち・個別失敗を画面で表示し、全件成功と扱わない。

### 追加の取得確認と点検コマンド

- AristaのブログHTMLで公開されているRSSを確認し、10記事の見出し・本文抜粋・ANET関連付けを検証。
  RSSは全文ではなく短い抜粋（例: 563文字）なので、全文での関連銘柄判定と同一視しない。
- Marvellブログの一覧は取得成功し個別URLを抽出できたが、個別本文はタイムアウト。
  成功扱いで登録せず、再検証対象として残した。Google Cloud release notesは195バイトの
  Site Unavailable応答であり、正常な製品変更取得として登録していない。


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

### 設定の対応表（設定済み。秘密値は含めない）

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
SKHY、NBIS、NVDA、MSFT、DELL、CRWV、ANET、AMD、BE、GOOGL、MU、MRVL、VRT、ARM、AVGO、TSM、SNDK、ORCLの18銘柄（MRVLは常駐403。TSM/SNDK/ORCLは直近の常駐失敗を未解消。ARMは公式RSSへの切替後の常駐確認待ち）。これは既存取得元が扱う製品記事を含めた
全体の網羅率ではない。共通元のSemiAnalysisとAnthropicは全22銘柄へ本文照合し、
特定銘柄のニュースとして無条件には配信しない。

「次に検証する情報」は調査対象。取引関係や取得可能性が確認済みという意味ではない。

| 銘柄 | 登録済み公式取得先 | 今回の銘柄固定の補完元 | 次に検証する情報 |
|---|---|---|---|
| MU | [Micron](https://www.micron.com/about/press/news) | 公式ブログサイトマップ | HBM・DRAM製品ブログ／顧客の採用発表 |
| SKHY | [SK hynix](https://news.skhynix.com/en/category/ir/) | SK hynix Newsroom | HBM・製造技術／韓国語の公式発表 |
| SNDK | [Sandisk](https://investor.sandisk.com/news-events/news-releases) | 投資家ニュース一覧（常駐確認待ち） | NAND・SSD製品発表／決算資料 |
| NBIS | [Nebius](https://nebius.com/newsroom) | Nebius Blog、Preemptible VMs、Product changelog | 製品仕様・価格・障害／顧客・提携先／外部GPUクラウド評価 |
| NVDA | [NVIDIA](https://nvidianews.nvidia.com/rss.xml) | NVIDIA Developer Blog | 開発者情報／新製品の採用先・システム構成 |
| AMD | [AMD](https://ir.amd.com/news-events/press-releases/rss) | AMD News Blogs RSS | Instinct・EPYC製品情報／クラウド採用 |
| AVGO | [Broadcom](https://investors.broadcom.com/financial-information/financial-news-releases) | 投資家ニュースRSS（常駐確認待ち） | ネットワーク・カスタム半導体の製品情報／顧客側発表 |
| ARM | [Arm](https://newsroom.arm.com/news/feed/) | 公式ブログ一覧（常駐確認待ち） | 設計・ライセンス・エコシステム発表 |
| TSM | [TSMC](https://pr.tsmc.com/english/news) | Press Center（常駐確認待ち） | 先端プロセス・先端パッケージ／台湾の公式開示 |
| ASML | [ASML](https://www.asml.com/en/news/press-releases) | 未登録 | 露光装置・技術情報／受注・輸出規制の公式資料 |
| MRVL | [Marvell](https://investor.marvell.com/news-events/press-releases/rss) | Blog（手元成功・常駐403） | 光・ネットワーク・カスタム半導体の製品情報 |
| ANET | [Arista Networks](https://www.arista.com/en/company/news/press-release-rss) | Arista Networks Blog RSS | ネットワーク製品・技術ブログ／導入事例 |
| CRDO | [Credo](https://credosemi.com/) | 未登録 | 高速接続・AEC製品／採用発表 |
| CRWV | [CoreWeave](https://www.coreweave.com/) | CoreWeave Blog | クラウド製品・価格・障害／顧客側発表 |
| VRT | [Vertiv](https://www.vertiv.com/en-us/about/news-and-events/corporate-news/) | ラック技術ブログRSS | 冷却・電源製品／データセンター導入事例 |
| GEV | [GE Vernova](https://www.gevernova.com/news/subscribe/all/rss.xml) | 未登録 | 発電設備・受注・納入計画 |
| DELL | [Dell Technologies](https://investors.delltechnologies.com/news-events/press-release) | Dell Technologies Blog | AIサーバー製品／構成・導入事例 |
| PLTR | [Palantir](https://www.palantir.com/sitemap.xml) | 未登録 | 製品・顧客事例／提携先の公式発表 |
| MSFT | [Microsoft](https://news.microsoft.com/source/feed/) | Microsoft Blog | Azureの製品・設備投資／顧客・供給側発表 |
| BE | [Bloom Energy](https://investor.bloomenergy.com/rss/pressrelease.aspx) | Bloom Energy Blog RSS | 発電設備・受注／導入企業の公式発表 |
| GOOGL | [Alphabet / Google](https://blog.google/rss/) | Google Blog Cloud RSS | Cloud・TPU・データセンターの製品・技術情報 |
| ORCL | [Oracle](https://www.oracle.com/news/) | 投資家ニュース一覧（常駐確認待ち） | OCI製品・設備／顧客・提携先発表 |

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

## 2026-09-24 新着優先処理と費用確認

- HTML一覧で新着本文の取得に一時失敗すると、未取得の過去記事が先に処理される問題を修正。
  初回取り込みと新着を区別し、新着の再試行を優先。過去記事・更新確認にも1枠を確保し、
  1巡回あたり最大3記事とエラー時の待機時間は維持する。
- 新着再試行、過去記事の進行、バックオフ中の記事を取得しないことを合成データで確認。
- AMD公式News Blogs一覧が案内するRSSを取得し、9件の見出し・抜粋・AMD関連付けを確認。
  例: EPYCのagentic AI記事の抜粋167文字。全文ではない。補完監視は12経路となる。
- Palantir公式ブログはHTTP 403のため追加せず。制限の回避は行わない。
- Railway管理画面はLimited Trialのまま。有料契約・支払方法の変更なし。
  公式料金資料ではトライアル終了後は月$1のFree枠、Hobbyを選ぶ場合は月最低$5
  （$5分の使用量込み、超過分は加算）。現在の常駐構成が無料枠に収まるかは未検証。
  https://docs.railway.com/pricing/free-trial
  https://docs.railway.com/pricing/plans

## 2026-09-24 05:23 UTC 点検と補完元追加

- 稼働中の12経路をPreview管理画面で確認。11経路成功、Anthropic個別1記事失敗。
  CoreWeaveの過去記事取り込み待ちは解消。キュー297件は新着件数ではない。
- Bloom Energy公式ブログが案内するRSSから10件取得。本文例4484文字・9452文字。
- Google公式Cloudページが案内するRSSから20件取得。短い抜粋のため全文扱いしない。
  cloud.google.com/blog/products/rss はXMLではない応答で、こちらは登録していない。
- 新規2経路追加後は14経路、銘柄固定の補完元は10/22銘柄。網羅保証ではない。
- 他チャットのリモート更新0951098をfast-forwardで統合。
- 次の作業とAPI見積もり状況は TECH-PHASE-PROGRESS.md に集約。

## 継続改善

MU・MRVL・Vertivの追加とAnthropicの長文対応は TECH-PHASE-PROGRESS.md の9/24追記を参照。
補完22経路の設定登録と実環境での取得成功は区別する。後から追加した5経路はBroadcomのみ常駐成功。MRVL/TSMCの常駐403、Sandiskのtimeout、Oracleの応答不正が残る。Armは公式RSSへ切り替えたため常駐再確認が必要。

## 2026-09-24 06:28 UTC 公式RSS切替の記録

- Broadcom: 公式IR RSS。常駐環境で10記事取得、作業環境でも10記事を解析。
- Arm: 公式ニュースルームのCompany RSSに切替。作業環境では6記事と本文抽出を確認。
  常駐環境へ未反映のため運用成功とはまだ数えない。
- Oracle: 公式IRサイトが案内するRSSに切替。ただし作業環境からの応答はHTTP 200の
  「Site Unavailable」HTML（195 bytes）でRSSではなかった。常駐確認後も失敗なら代替へ戻す。
- TSMC: 公式Press Centerが常駐環境で403。制限の回避は行わない。
- Sandisk: 公式IR一覧が常駐環境でtimeout。作業環境でも安定確認できていない。
- したがって追加5経路すべての稼働確認は完了していない。記事が配信されないことと
  取得に失敗していることを区別する。

## 2026-09-24 06:35 UTC 最新Preview状態

- `cbb687d` の常駐デプロイはOnline。22経路中17成功、5失敗。
- Broadcom RSSは10件取得。Armは新RSSへ切替後も`invalid-source-response`で未成功。
- MRVLとTSMCは403、Sandiskはtimeout、Oracle RSSは`invalid-source-response`。
- Micron sitemap本文は3件処理、409件待ち。キュー383件は新着数ではない。
- 安全な固定コードで取得失敗をもう一段詳しく表示する診断改善を実装中。
