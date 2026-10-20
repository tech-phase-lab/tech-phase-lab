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
