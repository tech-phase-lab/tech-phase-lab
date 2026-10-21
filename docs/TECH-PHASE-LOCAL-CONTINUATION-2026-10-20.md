# Vercel停止中の作業記録 — 2026-10-20

> 最新の作業範囲（22:29 JST）：PRO会員・決済のみ。決算取得・ニュースはユーザーから変更禁止の指示あり。本記録後半のニュース対策案は撤回済み・公開禁止。

## 基準と復元

対象は `codex/research-preview` のみ。main・RESOLUTEは変更しない。旧基準HEADは `30eda76f`。21:31 JST以降の再開時に環境の自動整理でローカル作業フォルダーが消えていたため、GitHubから再取得した。最新HEAD `009c97e3` にはRESOLUTEの2コミットが追加されており、そのまま保持。未公開のビルド判定処理・6テスト・監視記録・本記録を会話の変更履歴から復元した（文書は最新情報で再構成）。秘密情報をファイルに再作成していない。

## 請求周期と開発方針

21:29 JSTの運営者スクリーンショットで請求期間 **2026-09-28〜2026-10-28** を確認。更新日は10月28日。正確な時刻・タイムゾーンは画面に表示されていない。個別の再開操作が必要とされるため自動復旧は約束しない。

追加push・デプロイ・有料Sandbox作成は保留。ローカルで実装・検証を進める。予算増額・保存スナップショット削除・共有設定変更は行っていない。停止中も保存料金は残り得る。本番の総額は利用量次第であり、開発関連費用の減少と混同しない。

## 未適用のビルド省略処理

`scripts/tech-phase/ignore-vercel-build.mjs` はVercel Ignored Build Step用。終了0で省略、1でビルド続行。

- previewかつ対象ブランチのみで判定。
- 最後の成功デプロイ `VERCEL_GIT_PREVIOUS_SHA` と現在SHAを比較。直前コミットだけでは判定しない。
- docs配下のMarkdown、ルートREADME.md、AGENTS.mdだけの変更を省略。
- SHA不明、履歴不足、祖先関係なし、チェックアウト不一致はビルド。ネットワーク取得なし。
- 同一SHA再デプロイと `TECH_PHASE_FORCE_BUILD=1` はビルド。
- コードから文書へのリネームやdocs内JSONは省略しない。

vercel.json・Vercel共有設定は変更していないため、まだ費用削減効果はない。導入候補コマンドは `node scripts/tech-phase/ignore-vercel-build.mjs`。適用前に既存設定と対象コミットへのファイル存在を確認する。コード変更の頻回ビルドとSandbox保存料は別途対処する。

公式資料:
- https://vercel.com/docs/spend-management
- https://vercel.com/docs/environment-variables/system-environment-variables
- https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel

## PRO通信処理の修正（未公開）

PRO専用のtransport/paypal/httpモジュールでストリーム読み取り後にロックを解放。PayPal・内部決済APIの非JSON応答は読み続けずキャンセルし、JSONに似た別メディア型も拒否する。内部APIの応答上限超過は503 billing-unavailableとし、購入者の入力上限超過400 inputと区別する。機密応答本文は外へ返さない。

復元したビルド判定6件と、通信の既存・新規検証9件の計15件がローカルで成功。以前のNode全体1,263件成功は旧ツリーの結果なので、復元後の合格として流用しない。公開前には最新リモートを統合し、AGENTS.mdの全ゲートを実施する。

その後、復元・修正後のツリーで `npm test` **1,267件すべて成功**。変更したJavaScriptファイルのESLintと `git diff --check` も成功。Python全体・Nextビルドは今回は実施していない。全変更をローカルでステージ済み、未コミット・未公開。Vercel設定適用も未実施。

## 残作業

### 21:49 JST以降 — 統合したローカル修正の全ゲート完了

基準HEAD `009c97e3` に、この記録に記載した未公開変更を統合したツリーで検証した。

| 検証 | 結果 |
| --- | --- |
| `npm test` | 1,270件成功、失敗0 |
| `npm run test:python` | 固定時計で2,545件成功、失敗0（約305秒） |
| `npm run build` | 成功。コンパイル・型確認・34ページ生成完了 |
| `npm run lint` | エラー0、既存警告5件 |
| `python3 -m compileall -q scripts/research tests` | 成功 |
| `git diff --cached --check` | 成功 |

テストとビルドはローカルのみで実行。購入者からの入金、PayPal操作、Clerk権限変更、GitHub push、Vercel/Railwayデプロイは行っていない。今回の一式はステージ済み・未コミット。RESOLUTEの実装変更は含めていない。

この結果でローカル修正の統合検証は完了。公開再開時にはリモート差分と共有デプロイ設定を再確認し、ツリーが変われば必要なゲートを再実行する。実PayPalのUSD・更新・返金/異議申立てと、公開URLでの購入帰還・複数会員の接続確認は未完了のまま。本番向け一般会員購入を有効化した結果ではない。

### 21:46 JST以降 — ブラウザー側の決済応答検証

`lib/membership/billing-client.ts` の読み取りも16 KiBで制限。HTML・JSON以外の応答はキャンセルし、壊れたJSON、null、配列を共通の通信エラーとして処理する。読み取りロックは成功・失敗とも解放し、購入リクエストは自動再送しない。PROなのに利用期限なし、FREEなのに有効期限ありという矛盾した利用状態を拒否する。画面レイアウトは変更していない。

ブラウザー関連7テスト成功（分割された日本語JSONの正常受信も含む）、TypeScript全体 `tsc --noEmit --incremental false` 成功、実装とテストのESLint成功。未公開・未デプロイ。

### 21:40 JST以降 — 複数会員のローカル分離検証

既存のSQLマイグレーションと実際のstoreをPGlite上で動かし、同額・同通貨の会員2人を作成して検証した。支払いID・イベントIDの他会員への流用、他人の支払期間取得と付与、解約と保留操作が拒否されることを確認。衝突したイベントはロールバックされ、支払いは2件のまま。片方へのDISPUTED保留後ももう片方のPROは有効で、完了イベントの再送でも保留は解除されない。解約した会員は期限の1ミリ秒前までPRO、期限ちょうどでFREE。

関連4ファイルのテスト34件成功、追加テストのESLint・差分チェック成功。業務ロジックの追加修正は不要だった。この結果はローカルのデータ分離検証であり、実PayPalの異議申立て受入や本番複数Clerkアカウントの接続確認ではない。テストと記録をステージし、未公開で保持する。

1. 日次10/21 09:30 JST、週次10/26 10:00 JST以降に実Cronと監視受信を確認。まだ未来の実行を合格扱いしない。
2. USD、実更新決済、返金・異議申立てと再送の実PayPal受入。ローカル模擬検証とは区別する。
3. 複数会員の契約・権限分離、本番Clerkへの接続。
4. 復号鍵のRailway外保管、失効・削除との照合を含む本番復旧受入。

既存Railway CronやHealthchecksを再作成・重複実行しない。

## 22:07 JST以降 — 10ドル追加後の決算優先・節約運用

運営者から10ドルを追加したとの連絡。取得・サイト利用を優先し、開発確認はローカル、公開は必要な変更をまとめる。新規有料Sandbox、予算再変更、不要な再デプロイは行わない。

- リモートHEAD `29ae7138` のRESOLUTE文書3ファイルをfast-forwardで取り込み。既存ステージ済み変更は保持。
- Railway research-monitor-stagingはOnline、保留中操作なし。22:10 JSTの実healthでMETA primary+supplemental、TSLA fallbackが約3秒周期で巡回し、直近errorなし。SECアクセスも正常。これは未来の決算本文取得成功を意味しない。
- 認証済みプレビュー `/research` はHTTP200、既存デプロイ `dpl_7wRsrsXKKnRteRHGo9uK1NHSsQQH` を配信。最新デプロイはBLOCKEDでも、既存サイトは応答している。再デプロイしていない。
- `/api/research/news` はHTTP200・ok=true。公式更新75件、最新publicAtは2026-10-20T12:27:42.394Z。Stock News側enabled=falseとは別にofficialUpdates等が返る。
- `/api/research/live` は2回ともsnapshotフォールバック、診断理由oversized-response。ニュースAPI復旧とライブAPI正常は区別する。
- ローカル `public_snapshot()` に応答の履歴サイズ調整を追加。2.5 MBを超えた場合のみ古い診断履歴を減らし、各URLの最新履歴・sources・events・briefs・discoveryRunsを保持。DB履歴は削除しない。historyWindowで省略件数を明示する。必須データだけで上限超過する場合は解消しないため、公開後のサイズ・automaticモード確認が必要。
- 従来の20件履歴・gzip応答テストと、日本語を含む大きな履歴の回帰テストは成功。修正は未公開であり実環境のoversized-response解消は未確認。

公式決算予定：Teslaは米国10月21日引け後、説明会は日本時間10月22日06:30。Meta公式検索結果では10月21日13:30 PT（日本時間10月22日05:30）の説明会。発表時刻と説明会は区別する。
https://ir.tesla.com/press-release/tesla-third-quarter-2026-production-deliveries-and-deployments
https://investor.atmeta.com/home/default.aspx

統合検証完了：Node 1,270件、Python 2,546件（約300秒）、Next本番ビルド、Lint（既存警告5件・エラー0）、compileall、ステージ差分チェックが成功。基準HEADは29ae7138。全14ファイルはステージ済み・未コミット・未公開。実環境live APIの容量超過は未解消として引き継ぐ。次の作業は必須ペイロード量の確認と必要な修正だけの公開、automaticモードの実測確認。PRO購入修正の一括公開や共有設定変更を先に行わない。

## 22:29 JST — ニュース差分撤回、PROに限定

ユーザーの指示を受け、今回だけ追加した `scripts/research/service.py` と `tests/test_research_service.py` の差分をHEADに戻した。ステージ・作業ツリー双方でこの2ファイルの差分がゼロであることを確認。ニュースの本番設定・デプロイは変更していない。先の対策は公開しない。今後、決算取得・ニュースの調査や修正をこの作業の対象にしない。

PRO購入の通信断復旧について、JPY/USDそれぞれでプロバイダー応答消失とローカル契約ID保存失敗の計4ケースを追加。実際のDBマイグレーションとstoreを用い、再開で同じ契約ID・通貨を再利用すること、契約が1件のまま、承認前の入金台帳が0件であることを検証する。PayPal側は模擬実装のため実PayPal受入とは区別する。

検証結果：追加4ケースを含むNode全1,271テスト成功、失敗0。変更テストのESLintとステージ差分チェック成功。今回のPRO作業は回帰テスト追加のみで、既存処理が通信断後も同じ契約キーを使うことを確認できた。未コミット・未公開。実PayPal USD購入・更新・返金/異議申立ての受入は未完了。

## 22:33 JST以降 — PRO異議申立て・保留の実装

作業範囲はPRO会員・決済・PRO専用バックアップだけ。ニュース取得/決算取得の調査・変更はしていない。RESOLUTEの処理や共有環境も変更していない。

### 照合補助処理

`recovery.mjs` はエラーHTTP・非JSONを読み続けずキャンセルし、成功/失敗とも読み取りロックを解放する。JSONメディア型は正確に照合し、大文字小文字とcharsetを許容。PRO期限に文字列以外を許可しない。照合中に契約IDが変わった場合の拒否も検証した。

### 異議申立てと保留

既存ではDISPUTEDの契約保留はあったが、PRO webhookにはCUSTOMER.DISPUTE.*の接続がなかった。署名検証後のCREATED/UPDATED/RESOLVEDを追加。dispute_idと全seller_transaction_idを検証してから処理する。buyer_transaction_idは利用しない。重複取引IDはまとめる。解決通知だけで保留を解除しない。

異議申立てがローカル入金登録より先に届く場合も、PRO専用adverse_transactionsへDISPUTEDを保存する。`004_dispute_holds_sandbox.sql` は理由制約を拡張し、同じ契約の別の支払期間でも保留を維持する。返金先着→初回入金→更新入金という順序で旧viewが更新分のPROを許可するケースをローカルで再現し、新viewで停止、別会員のPRO維持、台帳非削除を確認する。

支払い照合後に保留があれば、結果はverifiedではなくreview-requiredを返す。既存画面の運営確認表示へつながる。PRO専用バックアップの復元後view照合も同じ契約単位の条件に合わせた。

### 未適用・公開時の順序

- 新しいSQLはローカルPGliteだけで実行。Railway DBには未適用。
- PROの専用Sandbox DBを対象確認して004を適用し、PRO billingと復元検証サービスを対応版へ更新する必要がある。旧コード/旧viewを混在させたまま完了扱いにしない。
- PayPalのPRO用Webhookに異議申立て3イベントが登録されているかは未確認・未変更。実Sandbox通知による到達/再送と、USD・更新・返金/異議の実受入は残る。
- 実PayPal購入/返金/異議作成、本番PRO権限付与、Cron再実行、GitHub公開、Vercel/Railwayデプロイは行っていない。
- 旧バックアップに旧viewと該当する返金先着データがある場合、新しい復元整合性チェックで失敗し得る。失敗を無視せず、隔離復元先に004を適用して再検証する運用が必要。

参照した公式資料:
https://developer.paypal.com/disputes/test-go-live
https://developer.paypal.com/api/customer-disputes/v1/schema.json

最終ローカル検証：PRO関連7ファイル55テスト成功、PROバックアップ19テスト成功、変更JSのESLint・PRO backup.pyの構文検証・ステージ差分チェック成功。今回の検証はPRO関連に限定し、ニュース・決算取得のテストや外部API確認は実施していない。全20ファイルはステージ済み・未コミット・未公開。最新統合ツリーの全リポジトリ公開ゲートは未実行なので、公開済み・公開完了として扱わない。

## 22:55 JST以降 — 保留状態をPRO購入画面へ接続

PRO statusのsummaryに現在表示中の契約のreviewRequired（真偽値）を追加。契約なし/別会員/保留されていない新しい契約はfalse。ブラウザーの型・検証も対応し、旧APIのフィールド省略は許容、文字列や数値・契約なしでtrueなどの壊れた応答は拒否する。

購入画面はサーバーから取得した保留状態を日英で表示する。再読み込みでも状態を復元でき、古い「支払いの照合完了」通知が残っていても保留表示と矛盾しない。購入画面のレイアウトは変更していない。初期読み込み中に購入/解約操作を出さない既存の制御も維持。

PayPalの支払情報が欠ける応答でも、既存の保留があればreconcileはreview-requiredを返す。入金/利用期限を推測して補完しない。別会員への保留漏れ、通常契約、保留契約、新規契約の切り替えを検証対象に含む。

PRO対象のテストのみを実行。型チェックは `tsc --noEmit --incremental false` 成功、変更箇所ESLint成功。稼働環境の変更、ニュース関連操作、RESOLUTE変更、決済実行、デプロイはなし。今回の画面/API接続は未公開で、実ブラウザーのPayPal往復受入は未完了。

最終統合PROテスト55件すべて成功（約14秒）。差分チェック成功。今回の追加分もステージ済み・未コミット・未公開。

## 23:05 JST以降 — 状態取得の整合性・会員分離・中断復旧

PRO summaryの契約選択、利用期限、確認待ち状態を1つのSQLへ統合。問い合わせの途中で返金/異議の保留が入っても、同じDBスナップショットの結果を返す。通常のstatus取得も3往復から1往復になる。期限の境界では期限直前がPRO、期限ちょうどでFREEとなることを確認した。

運営者限定Sandboxの返金・取消・異議通知は、既知の取引が別会員に属する場合、保留記録を書く前に除外する。運営者と別会員の取引が同じ異議通知に含まれる場合も運営者だけを保留する。未登録取引への先着通知は引き続き保存する。

異議の取引保留保存後、契約保留保存前にDBエラーを起こす検証を追加。途中状態でもFREEかつreviewRequired=trueを維持し、同じ通知の再送で契約保留を完了する。繰り返し通知後も保留・入金・利用期間がそれぞれ1件で、台帳を重複させないことを確認した。

検証結果：PRO関連58テスト成功、PRO専用バックアップ19テスト成功、変更JSのESLintと差分チェック成功。DB検証はローカルPGliteであり、実PostgreSQLや実PayPal通知の受入検証とは区別する。

変更はステージ済み・未コミット・未公開。ニュース/決算取得、main、RESOLUTE、外部サービス設定を変更していない。有料Sandbox・デプロイの追加実行なし。公開前の全リポジトリゲートと、004の専用Sandbox DB適用、対応サービスの更新、実通知の受入は引き続き未実施。

## 23:12 JST以降 — 解約完了表示と保存失敗からの復旧

ブラウザーの解約API応答はHTTP成功だけで完了扱いせず、status=cancelledの明示を必須にした。空オブジェクト、pending、active、真偽値、異なる表記、エラーだけの成功応答は拒否する。既存画面のエラー後の読み取り専用status再取得へ進み、解約を自動再送しない。日英画面とも同じ通信処理を使う。

PayPal側で解約できた後にローカルDB保存が失敗するケースを、JPY/USD × ACTIVE/SUSPENDEDの4条件で検証。再操作でPayPal状態を読み直し、解約要求は1回のままDBを修復する。さらに繰り返しても入金履歴は1件のまま保持する。PayPalは模擬実装、DBはPGliteであり、実Sandbox操作ではない。

PRO関連60テスト成功。変更箇所ESLint、TypeScript型チェック（tsc --noEmit --incremental false）、差分チェック成功。変更はステージ済み・未コミット・未公開。今回も外部決済・デプロイ・ニュース/決算取得・RESOLUTEへの操作なし。

## 23:17 JST以降 — 操作の契約ひも付け・応答検証・復旧監視

- 解約確認を真偽値ではなく契約UUIDにひも付けた。別契約へ表示が切り替わった場合、以前の確認で解約ボタンを有効化しない。日英の実コンポーネント出力で確認済み。
- create応答は正しい契約UUIDとSandbox承認URL、または承認後の明示状態を必須にした。reconcile応答も既知の結果とSandboxの利用期限整合性を検証する。不正URLの例外は共通の通信エラーに統一。どの失敗でも購入/照合を自動再送しない。
- 復旧監視は照合直後のstatusがreviewRequired=trueならreview-requiredを優先。照合結果verifiedの直後に保留された場合も成功扱いせず、既存entryの異常終了判定につながる。保留状態だけの変化もchangedに反映し、壊れた保留値を拒否する。旧APIのフィールド省略は引き続き許容。

PRO関連62テスト成功、変更箇所ESLint、型チェック成功。復旧entryのesbuildによる単一ESM生成、構文確認、設定なしのdisabled終了をローカルで確認した。生成ファイルは一時成果物であり未配布。

### 読み取り専用の稼働確認

PRO billing service `430ca5db-6ec5-48ec-b16f-cfb03fd70972` は既存コミット `69e8d80013f96c9fbe82e0d974be235e8940350a` 固定、保留中の変更なし。deployment `82b352cf-bf69-45c8-b4d9-5927ff8e5c37` はSLEEPING、sleepApplication=true。現在のローカル修正はまだ稼働版に含まれない。

PRO復旧サービス `7950fd63-99a9-49f3-9d7a-a7f319620e9e` の2026-10-20T13:17:11Z（22:17 JST）ログでTECH_PHASE_SANDBOX_RECOVERY、verified/pro/cancelled/changed=falseを確認。既存定期実行の観測であり、手動実行や再起動はしていない。PayPalのWebhook登録イベントは今回実参照できておらず未確認のまま。

### 次の反映手順と確認境界

1. AGENTS.mdは公開前に全体lint/Node/Python/build/compileallを必須とする。一方、ユーザーはニュース関連の操作を禁止しているため、今回はPRO限定検証まで実施。ニュースを含むローカル全体テストの実施可否を確認してから公開ゲートへ進む。失敗したニュースやRESOLUTEコードを独断で修正しない。
2. 公開直前に対象ブランチの最新HEADを確認し、他作業を保全。統合ツリーのゲート成功後だけ公開し、Git Data利用時はgit write-treeとの完全一致を確認する。mainは対象外。
3. PRO専用DBへ004を適用する手段と権限を確認し、DB更新後に対応billingとPRO復元検証サービスを更新。復旧Functionも対応版へ更新する。既存Cronや通知監視を作り直さない。
4. PRO専用Webhook `8RC86242WT392843H` の登録を参照し、不足があれば異議申立て3イベントをPROのURLにだけ追加する。共有SandboxアプリのRESOLUTE Webhookは変更しない。
5. 実Sandbox USD購入・更新・返金/異議の受入を実施。購入者の承認操作が必要なところはユーザーへ引き継ぐ。完了前に一般公開・本番PRO同期を有効化しない。

全変更はステージ済み・未コミット・未公開。追加課金を伴うSandbox作成、デプロイ、決済実行、Clerk変更なし。

## 23:23 JST承認後 — 最新共有ツリーで全体ゲート完了

ユーザーはニュースに異常を起こさない条件でローカル全体テスト・ビルドを承認。共有ブランチの他作業を保全して `6075fd0416f2f16a77acaae0ec2f2f9b68d2e36d` へfast-forwardし、既存のPROステージ差分21ファイルを保持した。

- Node全1,285テスト成功、失敗0。
- Python全2,547テスト成功、失敗0（固定時計、353.111秒）。
- Lint成功：エラー0、既存警告5件。
- Next本番ビルド成功。初回は外部接続制限でGoogle Fonts取得に失敗したため、アプリを変更せず、実サービス認証情報を除いた通常プロキシ設定で再実行して成功。
- Python compileall、作業ツリー/ステージ差分チェック成功。

テスト実行には実サービスの認証情報を引き継がず、Node/Pythonは外部HTTPプロキシを無効なローカル宛先へ設定した。ニュースのコード・稼働設定・取得サービス、RESOLUTE実装は変更していない。これらはローカル回帰検証であり、実PayPal受入や稼働ニュースの実測ではない。GitHub公開・外部DB更新・デプロイ前の記録。

公開直前に企業紹介ページ等の別作業が入ったため、`de5ea3c9cb65b8d3ca5a4e5460f08373e37c08e0` をfast-forwardで保全して取り込み、全ゲートを再実行。最終統合ツリーはNode **1,287件**、Python **2,547件**（272.055秒）、Lint（エラー0/既存警告5件）、Next本番ビルド、compileall、差分チェックすべて成功。最終ブランチ照合でもリモートはde5ea3c9のまま。DB004と稼働バックエンドの対応版更新は引き続き未実施であり、このローカル検証を実Sandbox受入の完了とは扱わない。

## 一括公開完了・PRO専用DB更新の承認待ち

全21ファイルを `2c0562051f1fe1434c2cb975e3b6500245c92d34` でcodex/research-previewへ公開。Git Dataのtree `065426b9200bf35d28ec49349ec6e2f2f65e167a` とgit write-treeが完全一致。expected_sha=de5ea3c9、force=falseで更新し、ローカルも同一ツリーへ整合した。main変更なし。

Vercel deployment `dpl_6mR9nDf2YfMm9MpYh3rjJTx8wH45` はREADYを確認。URLは `https://tech-phase-g9r18axvj-chehon7144-5412.vercel.app`。GitHub Actions `39441430451` は最後の確認時in_progressで、完了とは報告しない。実ブラウザー購入往復の検証は未実施。

DB004は未適用で、PRO billing/復旧Function/復元検証サービスも今回の版へ未更新。画面の変更は既存APIのreviewRequired省略と互換性を持つため、画面反映を異議処理の実稼働完了とは扱わない。

次の管理者操作はPRO専用DB `tech_phase_billing_sandbox` に004だけを適用するもの。既存PRO作業用サービス `d6d32277-2a77-4548-a875-8188e59966f4` は退役コード、restart NEVER、公開domainなし、staged changesなしを読み取り確認。一時的に管理者接続をここへ渡す新しい用途の承認を求める。前回のバックアップ用ユーザー作成承認をこのDDL操作の承認とみなさない。

実行候補は `/tmp/tech-phase-apply-dispute-holds.mjs` に準備・構文確認済み、未実行。明示action、専用DB名、Railway private host、current_databaseを照合。トランザクション、5秒lock timeout、30秒statement timeoutで004を適用し、制約を確認してCOMMIT。エラー時ROLLBACK、ログは安全な結果のみ。承認後、実行直前にサービス/保留変更を再確認し、管理者接続を終了後直ちに消し、退役コードへ戻す。RESOLUTEとニュースのDB/サービスを変更しない。

この公開後記録はローカルにステージするだけとし、文書のための追加Vercelビルドは発生させない。

## 23:44 JST承認後 — PRO Sandbox DB004・稼働版反映

ユーザーの「進めてください。ミスのないように。」で一時管理者接続による004適用を承認。既存PRO作業用FunctionだけにPostgres参照を一時設定し、専用DB/host/actionを検証してトランザクション実行。2026-10-20T14:59:04Z、deployment `6f6b7d5c-2f1c-4324-93e2-187ab556d4af` の `TECH_PHASE_DISPUTE_SCHEMA_READY` (migration=4, sandbox) を確認。

空文字による後片付けでは実行ログがadminPresent=trueとなったため、削除成功とは扱わず、管理者接続とactionを非認証文字列RETIREDへ上書きした。退役コードdeployment `e1dca8e9-0c8a-4b70-b29f-82780846768c` の2026-10-20T15:00:39ZログでcredentialRemoved=trueを確認。DB接続コードも退役コードに置換済み。

GitHub Actions `39441430451` の2ジョブ（PostgreSQL concurrency / Lint test build）は全ステップ成功。PRO billingと復元検証はコミット `2c0562051f1fe1434c2cb975e3b6500245c92d34` へ固定、復旧Functionも同版のバンドルへ更新。既存Cronは変更していない。

- billing: `8a9bfba0-d8a4-4533-b9f1-9847cc57dc55` SUCCESS
- restore-check: `4bb7b68b-1fe0-4eb3-8577-2365009f63ae` SUCCESS
- recovery: `7bdf0d4b-e8b1-490d-a3f0-72b62b2f42d1` SUCCESS

このSUCCESSは配備状態。更新後の復旧/復元処理の完了ログはこの記録時点では未確認。backupは既存版0c4bbce8を維持（dump暗号化処理に変更なし）。新スキーマを含むバックアップ作成を既存deploymentの再起動で開始した。復元検証は新バックアップの成功確認後に行う。

## 2026-10-21 00:18 JST — PRO専用Webhook通知追加

PRO専用Webhook `8RC86242WT392843H` と完全一致するURLを読み取り確認後、既存イベントを保持してCUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVEDの3イベントだけを追加。再GETで既存イベント保持と追加3件を確認。deployment `1e3a6833-795c-4528-8712-593e8b67c490`、2026-10-20T15:18:14Z `TECH_PHASE_PRO_WEBHOOK_READY`。

作業用コードは固定Sandbox API/固定Webhook ID/固定URL/actionを照合し、管理者DB接続がRETIREDであることを必須にした。実行前に追加・wildcard・異なるURL・異なる環境の4模擬ケースを検証。PayPalの異議申立てそのものや返金、追加購入は行っていない。設定後は一時PayPal参照/環境/actionをRETIREDへ置換し、全5項目を検証する退役コードへ更新した。退役後の実行ログ確認は続行中。

今回の対象はPRO専用サービスとPRO用Webhookのみ。RESOLUTE Webhook、ニュース/決算取得、main、Clerk本番権限は変更していない。一般公開、本番PRO同期、実Sandbox USD購入・更新・返金/異議の受入は未完了。この記録はローカルに保持し、記録だけの追加Vercelビルドは行わない。

### 00:20 JST — 配備後の実行確認完了

- 作業用Function `16902486-b7ad-4f51-a506-7a9e91c37649`：15:19:07Z、TECH_PHASE_PROVISION_RETIRED / credentialRemoved=true。今回使用した管理者接続、PayPal参照、環境/actionの計5項目がRETIREDであることを実行時に確認。
- 既存backup deployment `d0c57449-eaf8-44dc-9b13-67c7aa8e80da` を再ビルドなしで実行：15:19:06Z TECH_PHASE_BACKUP_OK、14,613 bytes、retained=1。監視start/finishともsent。
- 更新済みrestore-checkを再ビルドなしで実行：15:19:56Z TECH_PHASE_RESTORE_CHECK_OK。authenticated_decryption / pg_restore / ledger / entitlement_viewすべて成功。subscriptions/payments/periods/events各1、adverse_transactions/review_holds各0、promotion=false。監視start/finishともsent。専用隔離PostgreSQLへの復元であり、稼働DBに書き戻していない。異議データ0件なので実異議の受入完了とは扱わない。
- 更新済みrecoveryを実行：15:20:01Z TECH_PHASE_SANDBOX_RECOVERY、verified / pro / cancelled / changed=false。既存の支払済み解約契約を正常照合し、状態を保持した。create/cancel/captureは呼び出していない。
- 最後のRailway staged changesはなし。追加Vercelビルドなし。残る実Sandbox USD購入のPayPal承認には購入者本人の操作が必要。

## 2026-10-21 00:25 JST — USD購入後の照合409を調査・修正

購入者から「支払いを確認できませんでした / 契約中 / PRO」と報告。HTTPログはcreate=200、支払後Webhook/reconcile=409。PROは以前のJPY購入による有効期間であり、今回USDの照合成功を示さない。

専用backup読取ロールとBEGIN READ ONLYで最新の所有者USD契約のみ参照し、Sandbox PayPal GETで照合。管理者接続はRETIREDのまま。diagnosis deployment `1d80cc49-f560-489a-ae91-c83be1e9053b` SUCCESS、15:27:09Z：契約ID/custom_id/plan一致、ACTIVE、USD20.00 COMPLETED、同一支払時刻、未払0、失敗0、ローカルpayments=0/holds=0。

実データはstart_time=2026-10-20T15:23:54Z、last_payment=15:24:34Z、next_billing_time=2026-11-21T10:00:00Z。初回更新がUTC暦日で翌日になっており、従来の同日必須判定が拒否原因。初回に限り月境界から24時間未満の正のずれを許容し、PayPalが返した実日時を保存する修正を追加。金額・通貨・契約・完了取引の一致、二重登録防止は維持。更新2回目以降の判定は今回緩めず、実更新の受入は引き続き未完了。

実データ相当のPGlite回帰テストで初回照合、再照合による1件維持、解約後の同一期限保持、期限ちょうどの失効を確認。24時間以上/2日後への延長は拒否。既存テストも含めsettlement19件成功。DBマイグレーション追加は不要。

調査後、今回使った6項目をRETIREDへ戻し、退役deployment `510f04c7-5762-47ba-ae82-09523061bb52` SUCCESS、15:27:58Z credentialRemoved=trueを確認。新規購入、返金、解約、DB修正は実行していない。

並行作業の `c5eb09e847bbe9f2a872d8eba1328d2d8243e83a` をfast-forwardで保全して取り込み、PRO修正の全体公開ゲートを実行中。RESOLUTE側の変更を作り直したり変更したりしていない。

公開前の並行更新7ab9e72e（RESOLUTE）、64e5b0f7（カレンダー）をそれぞれfast-forwardで保全。こちらで内容は変更していない。最終64e5b0f7統合ツリーでNode1,297件、Python2,549件（285.429秒）、Lint0 errors/既存5 warnings、Next本番ビルド、compileall成功。実サービス認証情報を引き継がないローカル検証。最後のブランチ照合は64e5b0f7で一致。公開対象はPRO settlement、回帰テスト、継続記録の3ファイルのみ。

## 2026-10-21 午前 — PRO復旧サービスの連続クラッシュ対応

USD修正はコミット8971917567c5ed7942a88ebfa433b5be5df7d352で公開済みだったが、前回accept-deploy呼出しは結果を取得できないまま中断。午前の実確認でpatch6b7daea7-6638-466d-948e-0dec58af1754がSTAGEDに残り、billingは旧版2c056205のままと判明。配備成功とは扱わない。

添付メールはtech-phase-billing-recovery-sandboxのDeploy Crashed。毎時再照合でGET status=200、POST reconcile=409、TECH_PHASE_SANDBOX_RECOVERY_FAILEDを確認。決済サーバー自体の停止ではなく、未反映のUSD日時判定により復旧ジョブが失敗していた。

保留差分がPRO billingのcommitSha1件だけであることを再確認し適用。deployment59449dd4-2121-4a3f-8ad4-be664f102dc7、commit8971917、2026-10-21T01:55:47Z開始、SUCCESSを確認。既存Dockerfile/環境変数/DB/cronは変更なし。復旧サービスの既存deployment91de0dba-7bb5-4afb-921d-4a12253c2ad5を再実行し、実照合結果を確認中。通知は無効化していない。ニュース、決算取得、RESOLUTEへの操作なし。

ローカルindex treeと公開commit treeの完全一致を確認してHEADを8971917に整合。今回の運用記録は追加Vercelデプロイを避けローカル保持。

01:56:38Z（10:56 JST）、復旧サービスSUCCESSとTECH_PHASE_SANDBOX_RECOVERY / outcome=verified / plan=pro / state=active / changed=trueを確認。今回のUSD契約が新しいbilling実装で照合され、支払済み権限へ反映された。再実行時の安定性も確認する。

01:57:28Z（10:57 JST）の再実行もSUCCESS、verified/pro/active/changed=false。2回ともstatus→reconcile→statusがすべてHTTP200で、同じ契約の正常状態を維持。今回の連続クラッシュの原因は解消。次回以降の定時実行の観測は未実施。通知設定や毎時cronを隠す/無効化する変更は行っていない。

## 2026-10-21 11:19 JST — USD購入後のバックアップ・復元確認

既存のPRO専用backup/restore-checkをそれぞれ一度だけ再ビルドなしで実行。02:19:04ZのTECH_PHASE_BACKUP_OKは14,839 bytes、retained=2。02:19:33ZのTECH_PHASE_RESTORE_CHECK_OKでsubscriptions/payments/periods/events各2件、adverse_transactions/review_holds各0件を確認。authenticated_decryption、pg_restore、ledger、entitlement_viewの4検証が成功、promotion=false。両ジョブとも監視start/finish=sent。

初回JPYと今回USDを含む記録の復元であり、稼働DBへの書き戻しはしていない。Railway保留変更なし、PROのCron設定変更なし。復旧サービスはSUCCESSを維持しているが、02:16Z以降の定時実行ログは取得時点で0件。手動成功を定時実行確認の代わりにしない。

追記：02:21:48Z（11:21 JST）の自動実行でTECH_PHASE_SANDBOX_RECOVERY、verified/pro/active/changed=falseを確認。今回はrecoveryの手動再実行を行っておらず、修正後の既存Cronによる成功を確認できた。サービスstatus=SUCCESS。

### 次の実Sandbox受入操作（未実行）

対象は今回のUSD20.00購入（2026-10-20T15:24:34Z）のみ。USD契約の自動更新停止と全額テスト返金を行い、PayPal署名付き通知→返金保留→再照合→利用状態を確認する候補。返金はテスト取引でも元に戻せず、購入済み契約状態を変更するため実行前に確認する。JPY取引やRESOLUTEは対象外。

期待結果は「USD契約の要確認状態と、JPYの支払済み利用期限2026-11-20T10:00:00ZによるPROの維持」。USDの期限2026-11-21T10:00:00Zを残してはいけない。JPY期限ちょうどではFREE。通知再送でも台帳2件を維持し、返金後のアクセスを復活させない。この同一会員・2通貨の併存ケースをローカル回帰テストへ追加。実PayPal返金、解約、異議申立ては未実行で、本番のClerk権限も変更していない。

追加テストを含むnpm testは1,298件成功、失敗0（162.857秒）。初回は分離環境のPATHがシステムPythonを選びaiohttp不足で失敗したため中断し、インストール済みランタイムPythonを指定して再実行成功。アプリやニュースのコードを変更して解消したものではない。実サービス認証情報を渡さず、外部HTTPプロキシは無効なローカル宛先。差分チェック成功。今回追加したテストと運用記録はローカルにステージのみ、未コミット・未公開。公開前に必要な全体lint/Python/build等は今回まだ実行していない。

## USD解約・20ドル返金の承認後 — 一時認証情報の設定が自動審査で拒否

ユーザーの「いいですｙO!」でUSD Sandbox契約の解約と20ドル全額テスト返金を承認。固定所有者、USDプラン、支払日時、金額、JPY残存権限を照合する一回限りの処理をscripts/tech-phase/sandbox-usd-refund-acceptance.mjsへ準備。期限2026-10-21T04:00:00Z、専用backupロール＋BEGIN READ ONLY、既存billing API経由の解約、PayPal sale API全額返金、固定冪等キー、変更系自動再試行なし。事前inspect/事後observeは返金・解約を呼ばない。PayPal公式sale-refund仕様を確認（https://developer.paypal.com/api/deprecated/payments/v1/sale-refund）。

依存注入によるオフライン4テスト成功：対象照合、金額/環境/期限等の不一致拒否、inspectと返金済み再実行の非変更性、解約失敗時の返金禁止、返金応答消失時の再試行禁止。これは実PayPal受入ではない。

既存作業用Functionの退役コード、restart NEVER、stagedなしを読み取り確認後、skipDeploys=trueで一時参照を設定しようとしたが、自動承認審査に拒否された。理由は「廃止済みサービスへPayPal・DB・サービス認証情報を参照設定として投入する持続的な資格情報露出で、返金確認に不要かつ明示承認もありません」。設定成功ではない。Functionコードの書換え、解約、返金、再デプロイは実行していない。拒否された方法を迂回しない。

再開には、このPRO専用作業用FunctionへPayPal Sandbox参照、PRO APIトークン参照、専用DB読取パスワード参照を一時的に設定する明示承認が必要。管理者DB接続はRETIREDを維持し、終了時は今回の全参照/actionをRETIREDへ戻して7項目確認の退役コードに戻す。認証情報をローカルやログへ出さない。実行期限を過ぎた場合は期限を黙って延長せず、承認された作業範囲と未実行状態を再確認する。全変更はローカル保持、main/ニュース/RESOLUTE変更なし。

### 11:32 JST — 一時参照承認後もFunction差し替えが別審査で拒否

ユーザーは一時設定と終了後解除の方法に「いいですよ。」と明示承認。7項目のset_variables(skipDeploys=true)は成功したが、準備済みFunctionコードへのupdate_function_source_codeは自動審査で拒否。理由は「退役済みFunctionをライブ更新して解約・返金コードを実行可能な状態にする変更であり、認証情報設定の承認だけではこの追加の本番コード置換と即時デプロイまで明示承認されていません」。ここでいう環境名productionは既存Railway環境名で、対象API/専用DB/契約はSandboxに限定される。

拒否後ただちに今回の7項目をすべてRETIREDへ戻すset_variables(skipDeploys=true)が成功。解約・返金コードは配備されず、inspectも未実行。元の退役コードを7項目確認へ拡張する後片付けのみ実施している。再開には一時認証設定だけでなく、専用Functionのコード差し替え・配備、対象契約の解約/返金、後片付けまでの一連の実行について明示承認を求める。拒否された実行を別経路へ迂回しない。

後片付けの退役コード更新は許可・成功し、get_function_source_codeで7項目をRETIRED照合するコード、stagedなしを確認。今回の認証参照の解除設定は成功しているが、新しい退役コードの実行ログは取得時点で0件のためcredentialRemoved=trueの新しい実行確認とは扱わない。コードにはDB/PayPal接続や契約変更処理が一切ない。

## 11:40 JST以降 — 一括承認取得済み、Railwayの配備停止で未実行

ユーザーは「PRO専用Functionの一時更新・配備を含め、USD契約の解約、20ドルのSandbox返金、反映確認、認証情報の解除まで一括で実行すること」に「いいですよ。進めてください」と明示承認した。同じ範囲の承認を再要求しない。

7項目の一時設定とFunction更新が成功応答を返したが、最新deploymentは旧退役版510f04c7のままで実行ログ0件。明示的なstaged更新も試し、patch4fb7bd13-f92b-4d19-b9f3-68254bc4f451の変更がPRO作業用Function1件のみと確認してaccept-deploy成功。それでもdeploymentは作成されなかった。

作業用Function（Dockerイメージghcr.io/railwayapp/function-bun:1.4.0）のredeployを一度だけ呼び、具体的な「Deploys have been paused temporarily」エラーを取得。再試行を重ねず中止。これは認証や追加承認待ちではなく配備側の阻害。公式status.railway.comは確認時Fully Operationalで、全体障害や課金上限が原因とは断定できない。既存の稼働billing/復旧/バックアップを停止・再配備していない。

今回もactionはinspect-usd-refundのままであり、execute-usd-refundへ切り替えていない。事前inspect自体が未実行、解約/返金も未実行。7項目すべてをRETIREDへ戻す設定が成功し、Functionコードも外部接続なしの退役7項目確認コードへ戻した。再取得でコード完全一致、stagedなし、環境pendingWorkなしを確認。実行ログでの7項目チェック成功とは区別する。ローカルの準備・検証結果と承認は保持。配備停止が解消したら未実行の対象を再照合し、承認済み範囲で再開する。
## 2026-10-21 12:05 JST — 配備停止の再調査

ユーザー承認済みのブラウザー調査で既存Railwayログインを利用。PRO作業用Functionだけを再配備し、03:01:31Zのad64d56b-35ba-447c-87fc-75e219499f0fがSUCCESS、TECH_PHASE_PROVISION_RETIRED/credentialRemoved=trueを確認。直後に連携APIの同じredeploy操作も成功し、03:02:00Zの4c6d38ba-6837-4307-8328-3add17dd62a0がSUCCESS、同じ退役ログを確認した。古い配備の構成を再使用した検証であり、7項目の新ソースを実行した証明ではない。返金・解約処理は実行していない。

現在の配備阻害は解消し、ブラウザー限定/API限定の恒常障害でもない。Usage画面はHobby、期間Sep26-Oct26、Current Usage29.48USD、Credits2.41USD。Compute Hard limit入力は空欄。上限やプランを変更していない。

公式障害JUA1PC5HはOct20 17:03〜20:56UTCの新規ビルド停止。停止中の配備/再起動要求はキューに入らず再要求が必要と記載。しかしこちらの停止応答は公式復旧時刻より後にも発生しているため、当該障害の残留状態/別の一時障害/連携経路のどれかまでは断定不可。恒常的な課金停止・コード不良が原因との証拠はなく、現在両経路が成功する事実まで確定。

メール対象のrecoveryは別途、初回USD更新日時判定の409による毎時失敗。再取得ログでOct21 01:22UTCまで失敗、01:56/01:57/02:21UTCはverified/pro/activeを確認。メール障害が配備停止を引き起こした証拠なし。ニュース・決算取得・RESOLUTE・mainは変更していない。

## 2026-10-21 12:11 JST — USD実Sandbox返金受入完了

承認済みの一時認証参照・Function更新・解約・20USD返金を実行。最初のinspect b900a90e-9e1f-4f9e-9635-4a62b797fc22はPROVIDER_PAYMENTで安全停止（この1回はCRASHED通知が発生し得る）。読み取り診断でPayPal金額value="20.0"、時刻15:24:34Zと判明し、検証スクリプトの"20.00"文字列限定が原因だった。金額を緩めず20/20.0/20.00を許可し、20.01/200/指数表記等を拒否する回帰テストを追加。製品billingのコードや日時判定は変更していない。

03:07:56Z inspect 4c9889a7-b5ff-4be1-9101-674ac9f39c43で契約ACTIVE、sale completed、台帳2件、holdsなし、USD期限一致を確認。
03:08:26Z execute 04f5f650-b756-4181-af1a-ab176f1b9d98でUSD契約CANCELLEDを確認、03:08:27Zに20.00USD返金completed、sale refundedを確認。固定冪等キー使用、変更系の再試行なし。
03:08:37/47ZのPRO Sandbox WebhookはHTTP200。03:09:00Z observe 0c515bab-2e25-48ea-935e-163b9ebe87e2でCANCELLED/refunded、reviewRequired=true、USD held/adverse=true、台帳2件保持、plan=pro、JPY期限一致/旧USD期限不一致を確認。現在のPRO期限は2026-11-20T10:00:00Z（11月20日19:00JST）。返金済みUSD契約の要確認表示は想定動作で、JPY支払分は有効。

03:09:33Z退役065e39f4-2e22-41e7-a82b-fb5d34a79411 SUCCESS、credentialRemoved=true、checked=7。一時追加7項目をRETIREDに戻し、返金コードも退役コードへ置換。旧配備の再実行は禁止。
03:10:05Z PROバックアップ成功14957bytes/retained2。03:10:36Z復元チェック成功、subscriptions/payments/periods/events各2、adverse_transactions/review_holds各1、authenticated_decryption/pg_restore/ledger/entitlement_view合格。promotion=falseで稼働DBへ戻していない。

UTC開始・期限ちょうど・同時刻のJST表現のテストも追加。全Nodeテスト結果は以下に追記。GitHub/Vercelへの公開なし。ニュース/決算取得/RESOLUTE/main/本番Clerk権限への変更なし。実更新・実異議申立て受入と本番開放は未完了。

### 12:14 JST — 返金後の毎時クラッシュを防止

返金後に既存recoveryを実行すると03:11:53Zでreview-required/pro/cancelled/changed=falseを正常に取得したのにCRASHEDとなった。原因はscripts/tech-phase/billing-recovery-entry.mjsがreview-requiredを無条件exitCode=1にしていたため。既知の返金保留を毎時の処理障害として通知する実装を修正。要確認イベントはstderrへ残し、例外時のexitCode=1とFAILEDログは維持。通知設定・cron・支払い保留・会員権限は変更しない。

実entryを子プロセスで実行する3テスト（要確認の正常終了とログ、例外の失敗と秘密非出力、通常成功）を追加、既存recovery8テストと合わせ11件成功。esbuildでローカルentryを全量bundleしてPROrecovery Functionへ緊急反映。deployment065286b4-4e89-43da-aa25-cd8ac90daae4 SUCCESS、03:13:40Zの再実行でもreview-required/pro/cancelled/changed=falseと要確認イベントを記録し正常終了を確認。Railwayはstderrイベントをerror表示するがプロセス終了はSUCCESSであり、要確認を消していない。次回自動cron実行の観測は未実施。

Node全体1304件/失敗0（157.719秒、entry追加前に開始したため新entry3件は別途11件の実行で検証）。GitHubへ未公開・未コミット。PROrecovery Functionだけは上記緊急修正を反映済みなので、今後古いGitHub版を再配備して戻さないこと。リモートブランチ更新前は最新取り込みと全公開ゲートが必要。

### 2026-10-21 — クラッシュメール再報告と修正後の自動実行確認

ユーザーは夜中から約13通のクラッシュメールを受信。添付IMG_3876.jpgの通知元はtech-phase-billing-recovery-sandboxと確認（メール日時は画像にない）。全13通の内訳は未照合。最新状態の「recent failures=0」は過去のクラッシュがなかった証明ではなく、01:19 JSTおよび06〜10時台のRECOVERY_FAILEDログと12:11 JSTの返金保留時の異常終了を区別して説明した。

修正後03:17:26Z（12:17 JST）の既存Cron実行はlastExecutionStatus=succeeded。03:17:33Zにreview-required/pro/cancelled/changed=falseと要確認イベントを記録。手動再実行だけでなく自動実行の成功を確認済み。要確認イベントはstderrのためRailwayログでerrorと表示されるが、この実行の終了は成功。返金保留を削除したり、クラッシュ通知・Cronを無効化したりしていない。

読み取り確認時、共用PostgresはOnline、RESOLUTEサービス群の24時間内クラッシュ記録なし。PROバックアップと復元チェックの集計に残る4件は10月20日19:57〜19:59 JSTの旧FAILED配備で、現在の版は成功済み。PRO APIのSleeping表示はクラッシュと区別する。ニュース取得の内容・配信結果を検証したわけではなく、ニュース/決算取得/RESOLUTE/mainへの変更は行っていない。

USD20のSandbox解約・返金は完了済み。期限付き受入スクリプトの期限延長や再実行は禁止。次に残る実受入は更新決済・異議申立て、複数会員の実認証接続、本番復旧であり、ローカルテストの成功だけで完了扱いにしない。

追記：04:19:30Z（13:19 JST）の次のCron実行もsucceeded。修正後2回連続の自動実行成功を確認した。

公開準備のローカル検証ではNode全1307件成功（177.360秒）、Lintエラー0/既存警告5件、Next本番ビルドと型チェック成功、compileall成功。最初のビルドは検証用外部通信遮断でGoogle Fonts取得に失敗したため、ビルドだけ通常のプロキシで再実行して成功。Python初回は2549件中17エラーで、外部通信遮断プロキシにlocalhostも送っていた検証環境の設定漏れ（ConnectionRefusedErrorおよびその派生エラー）。NO_PROXY=localhost,127.0.0.1,::1を追加して全体を再実行中。製品コードやニュースのテストを変更して回避していない。

Python再実行は2549件すべて成功（214.877秒）。これで全公開ゲートが成功。最終照合のリモートHEADは8971917567c5ed7942a88ebfa433b5be5df7d352で変更なし。公開対象は上記PRO専用entry・期限切れの受入補助スクリプト・回帰テスト3ファイル・この記録の6ファイルのみ。Railway側の緊急修正は既に稼働しているため、コード保全のための重複Railway配備や返金実行は行わない。

## 2026-10-21 — 複数テスト会員の準備（ローカル実装）

クラッシュ修正は50b54d77としてcodex/research-previewへ保存済み。並行変更cf1dd7cfを保持し、統合後Node1307件/Python2549件とlint/build/compileallが成功。GitHubのcommit statusでVercel2件とRailway stagingのsuccessを確認したが、これはGitHub Actionsの全ジョブ結果の代用ではない。

次の複数会員受入のため、TECH_PHASE_BILLING_SANDBOX_TEST_USERSを追加するローカル実装を準備。値は実Clerk user IDのJSON配列で最大5件、重複・不正なID・壊れたJSON・1024文字超を拒否。未設定では所有者だけの既存動作を維持。追加会員はPayPal Sandboxかつpreview/指定Railwayブランチだけで許可する。画面・gateway・backendで同じ判定を使用し、署名付きWebhookは台帳から解決した会員を照合する。リクエスト内の自己申告会員IDは使用しない。

この設定はVercel PreviewとPRO専用Railway billingの両方で一致させる必要がある。片側だけ許可してももう一方で拒否する。テスト会員の決済・返金・異議申立ての追跡を維持するため、一度購入した会員をリストから安易に削除しない。新規受付を止める場合は既存の購入スイッチを使用し、Webhook受信を維持する。

本作業では追加会員のID登録・実環境変数変更・新しい購入・既存契約変更・本番開放を行っていない。所有者用recovery Cronの対象も変更しない。実Clerk別アカウントでの購入/他会員分離確認は未実施で、ローカル検証と区別する。

検証結果：Node全1310件成功（172.235秒）、Python2549件成功（255.806秒）、lintエラー0/既存警告5件、Next本番ビルド・型チェック・compileall・差分チェック成功。初回Nodeは購入ページを直接コンパイルする既存テストが新importを解決できず1件失敗したため、実access関数を読み込ませ、指定会員の成功とlive/productionでの拒否も追加して再実行成功。テスト用IDしか使用していない。公開前リモートは50b54d77で変更なし。

実受入の開始前にPRO backendにもこの版を配備し、両側のリストを揃えること。フロントの公開だけでは別会員の購入は有効にならない。追加会員は別の実Clerkログインで本人確認し、メールアドレスやブラウザー申告値をそのまま許可IDにしない。

## 2026-10-21 16:04 JST — 追加Sandbox会員の実登録

ユーザーが別GoogleアカウントでTech Phaseへログインし、指定メールとClerk developmentの会員詳細を管理画面で照合。追加ID user_3Kzfz892Wv7mb3PU9I01OQrxXBW（10月21日作成）。所有者とは別会員。Clerkメタデータ・本番PRO権限は変更なし。

TECH_PHASE_BILLING_SANDBOX_TEST_USERSのJSON配列にこの1件を登録。Vercel tech-phase-lab / preview / codex/research-preview限定（env ID Lu1EasAW6IRHMadi）、Railway PRO billing 430ca5db-6ec5-48ec-b16f-cfb03fd70972のみ。既存リストは両側とも未設定と確認。Railway変数はskipDeploys=trueで設定後、ソースを検証済み8b8c5815へ固定する変更1件のみをstaged確認して配備。

Railway deployment bb7914b9-0de8-4fb3-9c97-d28a413a8815は07:03:40Zに起動、SUCCESS。設定commitShaは8b8c5815だがdeployment metaはef0ea77c。fetch差分で追加5ファイルはRESOLUTE記録のみ、services/tech-phase-billingに差分なしと確認。RESOLUTEの設定・実装には触れていない。

Vercelは8b8c5815の既存Preview deploymentを再配備。最初のtarget=previewはAPI400で未作成、受理されるtarget=stagingへ修正しdpl_CcLLybpeREmLikjRPydKaddhHDw3を作成。配備完了と追加会員の実ログイン状態でのreadiness/status確認は後続に追記。購入・解約・返金は今回未実行。

追記：Vercel dpl_CcLLybpeREmLikjRPydKaddhHDw3 READY、aliasError=null、commit8b8c5815を確認。追加会員の購入画面を本人のログイン済みブラウザーで開いてもらい、接続状態と未購入FREEを確認する段階。管理画面のログイン成功は購入画面の実認証検証の代わりにしない。今回の作業記録はローカル保存のみ。

## 2026-10-21 16:05 JST — 接続成功後に残る画面エラー

追加会員のスクリーンショットに「通信を確認できませんでした」と契約なし/FREE/購入フォームが同時表示。Railway bb7914b9の07:05:17Z readiness HTTP200/33ms、07:05:18Z status HTTP200/81msを確認。Vercel対象Previewログに対応readiness呼出しあり。画面コードではidentity-loading等の初回失敗後、認証SDKの準備完了でeffectが再実行され成功してもerrorが消えない。フォーム表示はreadyとsummary成立が条件で、通信失敗継続ではなくエラー表示残留と整合。

app/research/account/billing/screen.tsxのloadで状態取得・検証成功後にsetError("")を追加。共有認証Providerは変更しない。新しいライフサイクルテストでidentity-loading→status失敗→成功を同じstateで再現、失敗時購入不可、成功時エラー解除、readiness/status以外の決済操作0を確認。限定10テスト成功。全体公開ゲート実行中。ニュース/決算/RESOLUTE/mainの変更なし、購入未実行。

公開ゲート結果：Node1311件成功（175.665秒）、Python全体成功（詳細は検証ログ）、lintエラー0/既存警告5件、Nextビルド・型チェック・compileall・diffcheck成功。リモートef0ea77cと統合済みで、最新照合も変更なし。公開対象はPRO購入画面1行、再現テスト、この記録の3ファイルのみ。
