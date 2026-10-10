# 新商品とTech Phase本体の接続メモ

確認日: 2026-10-10（日本時間）。商品名は未定のため「新商品」と呼ぶ。
本書は現在の実装と接続案を共有するもの。購入・通知機能の完成を意味しない。

## 分担

- ChatGPT: Tech Phase本体、認証・会員権限との接続、ウォッチリスト。
- Claude: 新商品のコンテンツとツール。ニュース・目標株価の取得・翻訳・配信、ホーム・メニューの装飾もClaudeの担当で、ChatGPTは変更しない。
- 大きな仕様変更はユーザーに相談する。メールはユーザーが送信する。
- 共有ブランチは `codex/research-preview`。作業前に最新を取得し、他担当の変更を上書きしない。

## 現在の実装

- 本体: TypeScript / Next.js 16.2.4 / React 19.2.4（Vercel）。
- バックエンド: Python 3.12の常駐サービス（Railway）。既存データは永続ボリューム上のSQLite。
- ログイン: Clerk。`lib/membership/server.ts` が認証済みユーザーをサーバーで確認する。
- PRO: Clerkの非公開メタデータ `plan` と `proExpiresAt` で判定。開発用の管理者プレビューは本番の購入権限ではない。
- ID・メール: Clerkに存在。表示言語は現在ブラウザ内保存。会員共通の言語・タイムゾーン項目は未実装。
- 決済会社のWebhook、決済・購入権限DB、新商品の購入権限APIは未実装。
- 新商品用の終値メール、送信元ドメイン、SPF/DKIM、メール配信停止は未実装。既存Web Pushとは別の機能。
- Railwayの `research-staging` / `research-monitor-staging` は2026-10-10の設定確認時点でcron未設定。新商品の終値ジョブは未実装。
- Twelve Dataは未接続。ウォッチリストのサンプル価格・チャートは架空データ。

## 新商品の前提（ユーザーから共有済み）

- 2027年1月発売予定。日本語・英語の両方で提供。価格・商品名・2年目の継続料金は未確定。
- ルール作りの記事と計画ツール、1年間の終値アラート（メール）、相場の温度計、税金計算を含む。
- 税金計算の初期対象は日本在住者の日本の税制。英語版も対象範囲を明示する。
- 翌朝のフォローは任意で1回。見送りの判断を尊重する。
- 「あなたの計画では」を主語にし、売買の推奨や効果の断定はしない。
- 新商品の購入とPRO加入は別。FREE会員にも購入権限があれば新商品を提供する。

## 接続案（未実装・詳細は合意してから実装）

- 同じNext.jsアプリの別パスなら既存のClerkログインを共用する。別アプリの場合はルーティングとClerk連携を別途決める。
- 本体側の専用の決済・権限DBを正本にする案。既存ニュース監視DBには購入履歴を混在させない。
- ClerkユーザーIDと商品IDで購入を紐付ける。メールアドレスだけで権限を紐付けない。
- 買い切りのコンテンツ・ツール利用権と、1年間の通知利用権を別々に管理する。
- 決済の戻り画面やブラウザのフラグで購入権限を付与しない。検証済みの決済結果とサーバー側の権限で判定する。
- 新商品用の日次ジョブはニュース監視と分離し、米国の夏時間・休場・短縮取引に対応する。

## 次に合意すること

配置パス、専用DB、権限APIの入出力、通知の1年の起算点、返金時の権限、メールサービス、言語・タイムゾーンの保存先。
未合意のAPIやテーブルを既存実装として扱わない。認証・権限の共通部分を変更する前に本書へ変更案を記録する。

## 共同作業の記録先

接続仕様は本書、作業の引き継ぎは `docs/CURRENT-HANDOFF.md`。
変更ファイル、API・データ構造の変更、検証結果、未確認項目を記録する。
秘密情報の値は書かない。環境変数の最新の設定は各サービスで確認する。

プレビュー: https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/research/watchlist
見た目確認用サンプル: https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/research/watchlist/sample


## 追記 2026-10-10(Claude): 合意した内容と、Claude側の案

商品名は「RESOLUTE｜レゾリュート」に決定(2026-10-10)。サブタイトルは「暴落の夜も、上昇の朝も、自分のルールに立ち戻るためのキット。」このファイルや他の文書にある「新商品」は、同じものを指す。以下のうち、「案」と書いたものは未合意で、既存実装として扱わない。

### 合意した内容(ChatGPTの回答 2026-10-10)

- 権限DB: Railwayの専用Postgresを新設する案(推奨)。未作成。バックアップと復元確認は本体側が担当する。
- Pro判定: `plan === "pro"` かつ有効な `proExpiresAt` が現在より未来のときだけPro。期限切れ・欠落・不正値はFree。日時はUTCのISO 8601形式(末尾`Z`)に統一する案。
- 言語・タイムゾーン: Clerkの公開メタデータに `locale`(`ja` / `en`)と `timezone`(IANA形式)を追加する。設定画面と保存APIはChatGPTが、新商品の通知処理に接続する前に作る。購入権限は公開メタデータに置かない。
- Webhook: 本体のNext.js APIルートに置く。同じ決済会社ならProと新商品を商品IDで振り分け、会社が違えば受け口を分ける。検証・重複処理防止・権限更新の共通部分は本体側。
- 日次ジョブ: 新商品専用のRailwayサービス。ニュース監視には入れない。終値判定とメール処理はClaude、サービス構成と本体の権限連携はChatGPT。
- メール: Resendを第一候補。所有ドメインの送信用サブドメインでSPF/DKIMを設定する。アカウントとドメインは未用意。
- 商品ID: 名前と切り離した固定ID。商品名が決まってもIDは変えず、表示名だけ差し替える。
- 環境変数: `TWELVE_DATA_API_KEY` / `PAYMENT_WEBHOOK_SECRET` / `ENTITLEMENT_DB_URL` / `MAIL_API_KEY` / `MAIL_FROM_ADDRESS` / `NOTIFY_INTERNAL_TOKEN` を案として使う。すべてサーバー専用で `NEXT_PUBLIC_` は付けない。決済会社が複数なら `PAYMENT_WEBHOOK_SECRET` は会社別の名前にする。

### Claude側の案(未合意)

権限は2種類に分けて管理する。

| 権限(`kind`) | 使えるもの | 期限 |
| --- | --- | --- |
| `use`(買い切りの利用権) | コンテンツ、計画ツール、作ったルール、税金計算 | なし |
| `alerts`(1年間の通知利用権) | 終値アラート、翌朝メール、温度計のセクター別・兆し | 購入から1年。継続で延長 |

温度計の全体の針は、権限がなくても誰でも見られる。

権限DBの形(案):

```sql
CREATE TABLE entitlements (
  id               TEXT PRIMARY KEY,
  clerk_user_id    TEXT NOT NULL,
  product_id       TEXT NOT NULL,       -- 名前と切り離した固定ID
  kind             TEXT NOT NULL,       -- 'use' | 'alerts'
  starts_at        TIMESTAMP NOT NULL,  -- UTC
  expires_at       TIMESTAMP NULL,      -- NULL = 期限なし
  source           TEXT NOT NULL,       -- 'purchase' | 'renewal' | 'admin'
  payment_event_id TEXT UNIQUE NULL,    -- Webhookの二重処理を防ぐ
  created_at       TIMESTAMP NOT NULL
);
```

判定の考え方(案):

- コンテンツ・計画ツール・税金計算: `use` が有効。FreeでもProでも関係ない。
- 終値アラート・翌朝メール・温度計のセクター別: `use` が有効で、かつ `alerts` が期限内。
- 権限とProは別々に判定し、片方からもう片方を推測しない。例: `canUse(feature, { entitlements, now })`。RESOLUTEの権限判定にはProを渡さない。
- 日時はUTCで保存し、画面にはユーザーのタイムゾーンで出す。

日次ジョブ(案):

1. 米国の営業日の終値が確定してから1日1回動く。データ提供元の確定フラグで判断し、夏時間・休場・短縮取引に対応する。
2. 権限DBから通知を使える人と、その人の計画を読む。
3. 計画のラインと終値を比べ、1人につき1通にまとめる。
4. 冪等キー(ユーザー+日付+種類)つきで送信モジュールに渡す。同じキーは二重に送らない。
5. メールには配信停止リンクを付ける。停止した人には送らない。

### 次に合意すること(未合意)

- 配置パス(例: `/new-product`)
- 通知の1年の起算点
- 返金時の権限
- 決済会社が決まるまで、Webhookの受け口が1つか複数か
- 商品IDの名前(商品名が決まったので、例の `rizel_kit_v1` のままか、`resolute_kit_v1` などにするか。IDは後から変えない)
- Twelve Dataの契約は2026年11月中旬の予定。契約までは実データでの検証ができない。

### 2026-10-10 ユーザーによる確定条件（上記の案より優先）

- RESOLUTEの購入は必須。PROだけでは利用できない。
- 購入に1年間の通知利用権が含まれる。購入後のコンテンツ・計画ツールの利用と、期限つきの通知利用権を分ける。
- PRO会員の2年目の継続料金を無料にするかは未決。無料にする場合もPRO判定で通さず、RESOLUTEの通知利用権を延長・付与する。
- 本追記は接続仕様の共有であり、DB・Webhook・メール配信・新商品用ジョブの実装完了を意味しない。専用Postgresやメールサービスの新設・契約は別途相談する。

## 追記 2026-10-10 — RESOLUTE更新価格と支払い時の検証

この追記の確定条件は、上記の「2年目PRO無料化未決」等の古い記録より優先する。処理設計は未実装。

### ユーザーの確定条件（Claude経由で共有）

- 固定商品IDは `resolute_v1`。表示名と分離し、後から変更しない。
- RESOLUTE購入は必須。初回購入に1年間の通知利用権を含める。
- 2年目以降の1年間の通知利用権の更新価格は、FREE会員5,980円、PRO会員3,980円。PROでも更新料金が必要。
- 更新購入時にPRO価格で購入した後、PROを解約・失効しても、購入した1年間の通知利用権は維持する。PROは更新価格の決定だけに使い、RESOLUTE利用権・通知利用権の利用判定には使わない。
- リンク作成時にPROであっても、PRO期限が切れた後に古い割引価格で購入できる形にはしない。決済開始APIだけでなく、支払い確定を処理するWebhookでも金額とPRO資格を検証する。
- 返金なしを販売方針とする。ただし販売条件は未確定。決済会社の規約と特商法表記との整合はユーザーとChatGPTが確認する。例外的な返金・決済取消に対する権限処理は設計から除外しない。
- Railwayは新規契約せず、Tech Phaseの既存契約内にRESOLUTE用の専用DBと通知処理を追加する。既存ニュース監視のDB・ジョブとは分離する。
- DB・通知サービスを作成する前に、既存契約の利用状況・残りの利用枠と追加使用量による費用の見込みを確認し、このRESOLUTE専用チャットに報告する。確認・承認前は作成しない。

### 実装案（決済会社選定後に検証）

- 本人のClerk認証とサーバー側会員情報から価格を選ぶ。ブラウザ指定の価格、商品ID、ユーザーID、PROフラグは権限・価格決定の根拠にしない。更新は有効な買い切り利用権の所有者に限定する。
- 購入リンク・決済セッションを本人と注文に紐付ける。割引注文の有効期限は通常の注文期限とPRO期限の早い方まで。期限切れの古いリンクは決済会社側でも支払いを止める。対応しない決済会社では、この方式を完成扱いせず別の方式を選ぶ。
- Webhookは署名を検証し、決済会社側の注文・支払い完了情報を照合する。商品、購入者、通貨JPY、実際の決済金額、注文期限、支払い状態を確認する。決済会社の商品/価格IDと固定の内部商品IDは分けて管理する。
- PRO割引の資格は、決済会社が記録した支払い完了日時にPROが有効だったかで判定する。Webhook受信・再処理日時で判定しない。サーバー側にPRO有効期間と失効履歴、および注文時の価格根拠を記録し、支払い完了時点の資格を検証可能にする。現在のClerkメタデータだけで過去の資格を推測しない。履歴不足は有効扱いせず要確認とする。
- 割引価格が支払われたのに、支払い完了時点でPRO資格・注文期限が無効だった例外は、通常の更新として通知利用権を延長しない。注文を要確認として保持する。支払いを黙って無視したり、勝手に追加請求・返金したりしない。例外時の取消・返金・差額精算の扱いは決済会社の仕様と販売条件を踏まえユーザーと決める。Webhookでの拒否だけでは、既に成立した決済の防止にはならない。
- 決済イベントだけでなく同一注文/支払いの重複も防止し、注文処理と通知利用権の延長を同一DBトランザクションで行う。
- 未実装のため、期限切れリンク、支払い直前の失効、支払い後のPRO解約、Webhook遅延・再送、金額改ざん・他人の注文、DB障害を検証するまでは完成扱いしない。

### 残る未確定事項

- 更新価格の税込/税別、英語版の通貨・価格、期限前更新/期限後更新の起算点、更新を購入できる期間。
- 例外的な不適格割引決済・返金・決済取消の精算と権限処理。
- `/resolute`、権限API、計画データを同じ専用Postgresに保存する案は本チャットで提案済み。実装前に入出力とデータ構造を記録する。
- 温度計の各部分の権限、メールサービス、決済会社、DBの実際の追加費用は未確定。


## 2026-10-10 ChatGPT — RESOLUTE Hobbyバックアップと復元確認

- Railway Proへの変更は保留。既存Hobby内の追加費用は月3ドルを目安にし、超える見込みで相談する。検証用ニュース監視を除く月約7ドル＋通信料は仮見込みで、RESOLUTE通知処理は未算入。本番が20ドル超になるとは未判断。
- RESOLUTE専用Postgres（サービス表示名 `Postgres`、DB名 `resolute`）のみを対象に、新規 `resolute-backup` と `resolute-restore-check`、非公開Bucket `resolute-backups` を追加。既存サービス・他DB・既存変数・請求/プラン設定は変更していない。
- 日次 `0 0 * * *`（日本時間09:00）、週次 `0 0 * * 1`（月曜09:00）を設定。週次は保存完了済みの最新バックアップを復元するため、同時刻の日次完了前には前回分を対象にする場合がある。Cron時刻による初回実行と継続稼働は今後の確認事項。
- PostgreSQL 18の `pg_dump -Fc --no-owner --no-acl` で論理バックアップ。ageで保存前に公開鍵暗号化し、Bucketへ保存後に読み戻してSHA-256を照合。日次7日分＋ISO週ごとの最新4回分を保持。同日の再実行で日数を減らさない。
- 復元ジョブは本番接続変数を持たず、独立した一時Postgresクラスタ（Unixソケットのみ、永続ボリュームなし）へ復元。新設したテスト専用スキーマ `resolute_backup_probe` の架空データ2件を含むバックアップを取得・復号し、チェックサム、pg_restore成功、内容・件数・主キーの復元を確認。本番DBは上書きしていない。
- 初回手動バックアップ: 暗号化後2,286バイト（dump 2,086バイト）、処理2.240秒、起動・準備を含む約25.4秒。初回復元: 処理2.597秒、起動・準備を含む約24.4秒。スケジュール設定後の手動再実行もバックアップ1.120秒・復元1.832秒で成功。将来の実データ・アプリ全体復旧を検証した結果ではない。
- 新規ジョブは上限RAM0.5GB/CPU0.5、再起動NEVER、15分の実行上限。現在の小容量なら追加月0.1〜0.5ドルの保守的な見込み。暗号化後1GB級では月約2〜3ドルが目安。1GiB超はアップロード前に失敗扱いとして費用見直しを要求する。容量しきい値は請求上限ではない。請求額と継続運用の実測は未確認。
- 新規ジョブの主な変数: `RESOLUTE_JOB_B64`（本書と同じコミットのscripts/resolute/backup.pyをbase64化）、`RESOLUTE_BACKUP_MODE`、`BACKUP_BUCKET`、`BACKUP_ENDPOINT`、`BACKUP_REGION`、`BACKUP_ACCESS_KEY_ID`、`BACKUP_SECRET_ACCESS_KEY`。バックアップ側だけに `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` と `BACKUP_AGE_RECIPIENT`、復元側だけに `BACKUP_AGE_IDENTITY` を設定。値・接続文字列・鍵は記載しない。
- 復号鍵は復元用Railway変数と、Railway外の本人用非共有復旧ファイルへ保存。復旧ファイルを運営者のパスワード管理・オフライン保管へ移すことは別途確認する。
- 失敗通知: Healthchecks.ioの無料枠を候補とし、任意の `BACKUP_MONITOR_PING_URL` をコード側で準備。送信先とテスト送信の承認前なので変数は未設定・外部通知未送信。起動漏れの検知と通知到達は未確認。現在はRailwayの成功/失敗ログだけを記録する。
- 今後の課題: DBとBucketが同じRailwayアカウント内なので、アカウントにアクセスできない場合に備える暗号化バックアップの別保管を設計する。今回その別保管先は未作成。
- 権限DBスキーマ、決済Webhook、商品メール配信、RESOLUTE通知ジョブは引き続き未実装。税金計算20本通過もChatGPT未検証。バックアップ作成・復元は実確認済みだが、失敗通知を含む運用全体を完了扱いしない。

- リポジトリ検証: lintはエラー0（既存警告2）、Node619/619、Python2368/2368、Next.js build、compileall、git diff --checkが成功。保持期間のテストは同日再実行と年をまたぐISO週を含む。秘密値をコミットしていない。


## 2026-10-10 ChatGPT — RESOLUTEバックアップ失敗通知の接続確認

- 運営者によるHealthchecks.ioログイン後、Railway登録の運営者メールと一致する宛先を確認。20:17 JSTの許可に基づき、メール連携のテスト送信を1回だけ実施し、管理画面の「Test notification sent!」「Delivered」を確認。受信箱への到着は運営者による確認待ち。追加の失敗メール・復旧メールは送っていない。
- 新設監視は `RESOLUTE daily backup`（UTC `0 0 * * *`）と `RESOLUTE weekly restore`（UTC `0 0 * * 1`）、猶予30分。メールはこの2監視だけに割り当て、down only（失敗時だけ）で設定。実行漏れは猶予後、実行中の停止はstartから猶予後に検知する構成。実際の時間超過・失敗イベントでのメール発報は今回未実測。
- 新設Railwayジョブ2つだけに `BACKUP_MONITOR_PING_URL` を設定。値・鍵・接続文字列は文書・チャットに記載しない。既存サービス・DB・変数・請求/プラン設定は変更していない。
- 接続後の手動再実行: backup deployment `0a221376-c453-49e6-9c4b-65a8b8a56496` はSUCCESS、暗号化後2,286バイト（dump 2,086）、処理1.083秒・起動準備込み約25.1秒。restore deployment `35a2cd33-f9d9-43d8-a90d-82461baeae7e` はSUCCESS、処理1.919秒・起動準備込み約25.7秒。架空データ2件、チェックサム、復号、pg_restore、内容・主キーを確認。両ログの `monitor_ping_sent: true` とHealthchecks画面の受信・処理時間を確認。
- 監視の追加費用は無料枠を使用し0ドル。現在の小容量でのバックアップ構成の追加月0.1〜0.5ドル見込みを維持。請求実績・本番データ量は未確認で、月3ドルを超える見込みの場合は相談する。
- 未確認: 日次Cronの初回（10月11日09:00 JST）、週次Cronの初回（10月12日09:00 JST）、継続稼働、実障害・実行漏れでの発報、運営者の受信箱到着、復旧ファイルのパスワード管理/オフライン移行。Railwayアカウント喪失対策の暗号化バックアップ別保管も継続課題。これらまで完了したとは扱わない。
- 今回のリポジトリ変更は既存文書2本の末尾追記のみ。既存本文のバイト列保持と `git diff --check` を確認。


## 2026-10-10 ChatGPT — 担当範囲と権限APIの接続案（未実装）

- 運営者から20:45 JSTにテストメール件名 `"TEST" is DOWN` の受信報告があり、受信箱への到着を確認済みに更新する。これはHealthchecksの連携テストで実バックアップ障害ではない。追加テストメールは送信しない。Cron初回・実障害による発報・継続稼働は引き続き未確認。
- ChatGPTはRESOLUTEとTech Phaseの接続仕様、専用DB・バックアップ、認証と購入権限API、計画データの保存API、会員の言語/タイムゾーン設定、決済検証と権限付与、専用通知ジョブの接続・運用検証を担当する。Claudeはコンテンツ、計画ツール、シミュレーション、温度計、税金計算と終値・翌朝メールの判定/内容を制作する。ニュース・目標株価・ホーム・メニューは変更しない。
- 完了条件は、購入者がツールを利用でき、未購入者はPROでも利用不可、通知期限切れでは通知不可、更新と停止が正しく反映され、保存・配信・バックアップ/復元を実確認できること。決済会社と送信サービス、商用データ契約が未確定の箇所はテスト可能な範囲と本番確認を分ける。大きな仕様変更・追加費用・未許可のメール送信は事前相談する。

### Claude向け権限API案

- `GET /api/resolute/entitlements`。既存Clerkセッションで本人を認証。入力のuserId・メールアドレス・PROフラグは受け付けず、サーバーでClerk userIdを取得する。固定商品ID `resolute_v1`。本人用エンドポイントを通知ジョブ用に流用しない。
- 200レスポンス例（日時は例示、実データではない）。`use` と `alerts` を別々に返す。`canReceiveNotifications` は両方が有効な場合だけtrue。PROを判定に使わない。

```json
{
  "productId": "resolute_v1",
  "asOf": "2027-01-15T00:00:00Z",
  "use": {"status": "active", "startsAt": "2027-01-01T00:00:00Z", "expiresAt": null},
  "alerts": {"status": "active", "startsAt": "2027-01-01T00:00:00Z", "expiresAt": "2028-01-01T00:00:00Z"},
  "canUseTools": true,
  "canReceiveNotifications": true
}
```

- 各権限のstatusは `missing | scheduled | active | expired | revoked`。権限なしの日時はnull。`startsAt <= asOf < expiresAt` が通知期間の有効条件で、expiresAtと同時刻は期限切れ。利用権だけが期限なし。失効は明示的なrevokedAtを優先する。statusと能力フラグはサーバー計算とする。
- 401 `AUTH_REQUIRED`（未ログイン）、503 `ENTITLEMENT_UNAVAILABLE`（認証設定・DB・依存サービス障害）。障害を未購入200へ変換せず、権限を許可しない。全応答を `Cache-Control: private, no-store` とし共有キャッシュへ保存しない。
- ブラウザはこの応答を表示に使い、計画データの読込/保存APIは毎回本人認証・DB上の利用権・データ所有者を独立して検証する。画面上のフラグだけで許可しない。管理者プレビュー/PROのテスト権限はRESOLUTEの購入権限に転用しない。
- `canReceiveNotifications` は権限条件だけを表す。実配信は同意、停止設定、宛先確認、営業日とデータ確定、送信直前の権限再検証、重複防止も満たす必要がある。このAPIからメールは送らない。
- 計画データは専用Postgres内の権限とは別テーブルに保存する案。ルール・ライン・保有理由をClerk userIdに紐付け、更新競合を検知するversionを持たせる。通貨・数値精度・入力制限・削除/保存期間はClaudeの計画ツール仕様を受けて確定する。
- 初回通知期間の購入日起算、翌年同日までの年単位計算（うるう日を含む）、期限前更新時の延長開始日は詳細合意前。API例でこの商用ルールを確定したとは扱わない。返金なし方針の販売条件と例外時の失効処理も別途確認する。
- 実装順は権限スキーマ/読み取りAPI、計画保存APIとClaudeツール接続、決済・専用通知ジョブの接続、日英の一連の動作検証。次の実装で会員データ構造や共通認証を変更する場合は最新ブランチを確認し、この案と照合する。


## 2026-10-10 ChatGPT — 権限スキーマと本人用読み取りAPIの実装

- 実装追加: `db/resolute/001_entitlements.sql`、`lib/resolute/{entitlements,database-config,server}.ts`、`app/api/resolute/entitlements/route.ts`。`GET /api/resolute/entitlements` は先のJSON案どおり利用権/通知利用権と能力フラグを返す。ユーザーIDはClerkの検証済みセッションだけから取得し、ブラウザのuserId/PRO/管理者主張は使わない。
- `proxy.ts` は既存matcherを保持して `/resolute/:path*` と `/api/resolute/:path*` を追加。既存FREE/PRO判定は変更しない。今回RESOLUTE画面本体・Claudeツール・ニュース・目標株価・ホーム・メニューは変更していない。
- スキーマは専用DB名 `resolute` 以外でトランザクションを中止する。新規 `resolute.entitlements` の主キーはClerk userId＋商品ID＋kind。商品IDは `resolute_v1`、kindはuse/alerts、UTCのtimestamptz、明示的なrevoked_atを使用。useは期限なし、alertsは有限で開始より後の期限を必須とする。HTTPからスキーマ作成・購入権限付与はしない。
- このテーブルは現在の権限状態で、決済台帳ではない。1決済からuse/alertsの両方を付与するため、同じpayment_event_idに対する単独UNIQUEをこの表には置かない。注文/支払い/イベント台帳と二重処理防止はWebhook実装時に別途追加し、同一トランザクションで権限を更新する。初回1年/更新起算点の詳細計算と権限書き込みは未実装。
- DB読込はパラメータ化SQLで本人・固定商品だけを取得し、同一SQLのstatement_timestampを判定時刻にする。PRO・プレビューは受け付けない。未購入は200かつmissing/false、未ログイン401 AUTH_REQUIRED、認証/DB障害は503 ENTITLEMENT_UNAVAILABLE。全応答private,no-storeで、例外や接続文字列を返さない。不正な権限レコードも503になり許可しない。
- 新規依存はpg（本番DBクライアント）、@types/pg（型）、@electric-sql/pglite（開発テスト専用）。ENTITLEMENT_DB_URLだけを読む。他のDATABASE_URLやニュースDBへフォールバックしない。接続プールは上限2、接続3秒・SQL3秒・問い合わせ4秒。外部ホストは証明書検証を必須とし、sslmode=require/disable等の弱いURL設定は拒否。非公開postgres.railway.internalのみRailway内部接続として扱う。
- 検証: Node628/628（RESOLUTE追加9テストを含む）、Python2368/2368、lintエラー0/既存警告2、Next.js build/型チェック、compileall、git diff --checkが成功。隔離PGliteのPostgreSQLエンジンでスキーマ実行、他DBでの中止、制約、購入者/非購入者/別ユーザー、失効を確認。期限の開始直前・開始時刻・終了直前・終了同時刻、重複/不正レコード、PROだけでは不可、認証/DBエラーと秘密非開示も検証。
- ローカルのビルド済みNext.jsへHTTPリクエストを送って、設定不足時503＋private,no-store＋公開用エラーだけの応答を確認。Clerk実ユーザー・RailwayとのTCP/TLS接続・Vercelプレビューでの成功応答は未検証。PGliteの検証を実Railway DBの確認とは扱わない。テストで変化した既存SQLite fixtureと補助ファイルはコミットに含めない。
- 実環境ではVercel本体からRailwayの非公開DNSへ直接接続できない。DBを公開する変更や既存サービス/変数の変更は今回していない。スキーマはRailwayへ未適用で、購入権限DBが稼働したとは扱わない。今後は専用APIをRailway内部に置く構成などを、認証方法・費用・既存設定に触れる範囲とともに具体化し、必要な承認後に接続する。
- 次はClaudeの計画データ仕様との照合と保存API、実環境の接続方式。決済Webhook・実商品の通知配信・税金計算テスト20本の検証は引き続き未実施。


## 2026-10-10 ChatGPT — 非公開DBへの専用API接続仕様（推奨案・費用承認前）

### 構成と今回の状態

ユーザーから、DBを非公開のままRailwayにRESOLUTE専用APIを置き、Vercelのサーバーから認証付きで呼ぶ案の検討と、実装前の費用・仕様提示を依頼された。本節はその実装前レビュー用の推奨仕様で、専用APIは未作成・未実装。画面側の既存契約は維持する。費用が発生する設定は承認後に行う。

`画面/Claudeツール → Vercel /api/resolute/entitlements → HTTPS認証付きRailway resolute-api → 非公開Postgres resolute`

- 新設 `resolute-api` を既存のradiant-magic/production内、RESOLUTE DBと同じリージョンに置く。既存Hobbyを維持し、新規契約・プラン変更はしない。軽量Node.js APIを1レプリカ、永続ボリュームなしで稼働させ、Next.js画面全体は移さない。
- 外部へ公開するのは専用APIのHTTPS入口だけ。DBのTCP proxy・公開ドメインは追加しない。2026-10-10の読み取り確認でも専用Postgresの公開ドメイン/公開TCPは0件、既存deploymentはa81b42b9-8da3-4397-b3f1-8f5098531204で変更なし。
- API→DBは同じRailway環境の内部DNS接続。VercelへDB接続文字列を置かない。先の直接DB読込APIは、承認後にVercel側の転送処理とRailway側のDB読込へ分離し、権限判定を共有する。

### 追加費用の試算（実測ではない）

- Railway公式料金はRAM10ドル/GB月、CPU20ドル/vCPU月、外向き通信0.05ドル/GB。Hobbyは既存契約を使用するので、新しいHobby基本料をもう1件追加しない。税込・為替換算はここでは含めない。
- 小さいAPIの平均RAMを0.1〜0.2GB、平均CPUを0.005〜0.02vCPU、月の外向き通信を1GB以内と仮定すると、常時稼働でも約1.15〜2.45ドル/月。余裕を含めAPI追加分を月1〜3ドルと提示する。まだプロセスの実RAM/CPU・負荷を測っていないため保証額ではない。
- バックアップの現行小容量見込み月0.1〜0.5ドルと合算すると約1.1〜3.5ドル/月。従来の月3ドルの目安を超える可能性があるため、API追加費用の承認前にサービスを作成しない。これは既存DBの仮予算月5〜15ドルや既存Tech Phase費用とは別の追加分。RESOLUTE商品通知のメール/データ料金も含めない。
- Vercel側にもAPI呼出の実行時間・通信が増える。既存契約の使用量が未確認なので0円とは断定せず、実測時に別途確認する。今回この設定を追加していない。
- 初期リソース制限案はRAM0.25GB/CPU0.25/1台。両方を常時上限まで使うとRAM+CPUだけで月約7.5ドルとなり、通信は別。制限は月3ドルの請求上限ではない。起動時にRAM不足の場合も勝手に増枠せず相談する。
- 新設APIだけServerless候補。DBプールのアイドル接続を10秒程度で閉じ、定期DBポーリング/ウォームアップを入れない。睡眠は外向き通信やDB接続に左右されるため、節約を前提に予算を下げない。実負荷・起動遅延を確認してから設定する。既存DBとニュース監視のServerless設定は変更しない。
- 運用開始後24〜48時間とテスト終了後に平均RAM/CPU/通信から月額を再計算し、バックアップ込み月3ドル超の見込みで相談する。既存workspaceの請求/停止上限設定は変更しない。

### 認証と内部API

- 第一段階は読み取りだけ。Railwayの固定ルート `GET /internal/v1/entitlements` をVercelから呼ぶ。userId/productIdをqueryやbodyで指定させない。APIは本人のClerkトークンsubjectと固定商品resolute_v1でDBを検索する。
- Vercelは既存Clerk auth()でログインを確認し、サーバーで取得した短命セッショントークンを `Authorization: Bearer <session token>` として送る。同時にサーバー間専用の `X-Resolute-Service-Token` を付ける。ブラウザの任意ヘッダーをそのまま転送しない。秘密値はコード/チャット/ログへ出さない。
- Railwayは専用トークンを定数時間比較し、次にClerk Backend SDKでJWTの署名、有効期限/開始時刻、固定issuer、許可した正確なorigin（azp）、セッション種別とsubのuser_ID形式を検証する。本人トークンだけ、専用トークンだけ、改ざん・期限切れ・別Clerk環境のトークンでは通さない。PRO/管理者/画面のフラグから購入権限を推測しない。
- Clerk検証用には同じClerk環境の公開JWT鍵を専用APIへ設定し、Clerk管理用秘密キーをRailwayへ複製しない。鍵ローテーションは更新と検証を必要とし、更新前は許可しない。SDK検証に加えてissuer/azp/セッションclaimの欠落・不一致も明示的に拒否する。署名検証できないJWKS URLをリクエストから指定させない。
- previewとproductionは固定の許可origin/issuerで分離し、*.vercel.appのような全体ワイルドカードを使わない。初期接続確認はcodex/research-previewの固定プレビューだけ。本番ドメインや鍵は確認・承認後に追加する。
- 初期DB接続は専用の読み取りユーザー（例resolute_api_reader）とし、resolute.entitlementsへのSELECT以外を許可しない。既存postgres管理者のパスワードは変更しない。新設RESOLUTE DBへのスキーマ適用・専用ユーザー作成は明示的な移行作業で行い、通常のAPI起動やHTTPからDDLを実行しない。
- 計画保存、決済付与、通知ジョブは別の操作契約/権限。今回の読み取りエンドポイントを管理APIや商品メール送信APIとして転用しない。CORSでブラウザ向けの許可は追加しないが、CORSを認証の代用にはしない。

### 画面側の固定契約とエラー

| 項目 | Claudeの画面/ツールが使う契約 |
| --- | --- |
| 入口 | 同一オリジン GET /api/resolute/entitlements。Railway URLは呼ばない |
| 入力 | なし。既存Clerkログインだけを使用。userId/PRO/購入フラグは送らない |
| 200 | 先のproductId/asOf/use/alerts/canUseTools/canReceiveNotificationsと同じJSON。形は変更しない |
| 利用 | canUseToolsがtrueのとき。FREE/PROとは独立 |
| 通知権限 | canReceiveNotificationsがtrueのとき。実配信は別途同意・停止・宛先確認等も必要 |
| 401 | AUTH_REQUIRED。ログイン案内 |
| 429 | RATE_LIMITED。Retry-Afterに従って再試行 |
| 503 | ENTITLEMENT_UNAVAILABLE。確認できない旨と再読込を表示。未購入として購入へ誘導しない |
| キャッシュ | 全応答Cache-Control: private, no-store。権限の共有キャッシュ/固定購入済みフラグを使わない |

- Vercelの転送先は設定したHTTPS originと固定pathだけに限定。リクエストからURLを受け取らず、リダイレクトに認証ヘッダーを引き継がない。応答サイズとJSON形/固定商品IDを検証してから返す。DB情報や内部認証エラーの詳細をブラウザへ返さない。
- 依存APIの401/403（サービス鍵/JWT拒否）、5xx、異常JSON、タイムアウトはVercelで503へ変換し、権限を許可しない。ブラウザ入口の未ログインだけは401。GETの一時的な502/503・通信失敗は1回だけ再試行、合計20秒以内を案とする。将来の書き込みAPIを同じ規則で自動再送しない。
- APIは検証前の安価な認証拒否、同時実行制限、ユーザー単位のレート制限を用意する。外部から無制限の購入判定やDB接続を起こさせない。上限の具体値は負荷テストで確定し、Redis等の有料追加サービスは使わない。
- 将来の計画保存APIでも、Railwayで本人・利用権・データ所有者・versionを毎回検証する。画面でボタンを隠すだけでは許可しない。計画の項目/通貨/精度はClaudeのデータ仕様を受けて決める。

### 追加する環境変数名と変更範囲（値は記載しない）

| 設定先 | 新規変数 |
| --- | --- |
| Vercelの対象previewだけ | RESOLUTE_API_URL、RESOLUTE_API_SERVICE_TOKEN |
| 新設Railway resolute-api | ENTITLEMENT_DB_URL（読み取りユーザー）、RESOLUTE_API_SERVICE_TOKEN、RESOLUTE_CLERK_JWT_PUBLIC_KEY、RESOLUTE_CLERK_ISSUER、RESOLUTE_CLERK_AUTHORIZED_PARTIES、PORT |

- 全変数はサーバー専用でNEXT_PUBLIC_を付けない。DB接続文字列はRailwayだけ。サービス間秘密鍵の2つの保管先はVercelと新設Railway APIの環境変数に限定する。
- この構成にはVercelへの新規サーバー変数2つの追加が必要。既存変数の上書き/削除はしないが、「既存設定を一切変更しない」ままでは接続できないため、追加範囲を費用と一緒に事前確認する。既存Railwayサービス/変数・他DB・請求/プラン設定は変更しない。専用RESOLUTE DBだけにスキーマと読み取りユーザーを追加する範囲も確認する。

### 承認後の実装・検証順

1. 既存コードのDB読込をRailway専用APIに分離し、Vercel側は固定契約の転送処理に変更。ローカルで両段の認証、JSON、エラー、権限境界を検証し、AGENTS.mdの全チェックを通す。
2. 費用と追加範囲の承認後に新設APIを作成し、RESOLUTE専用DBにスキーマ/読み取りユーザーを適用。移行前に暗号化バックアップを取得する。接続文字列や鍵はチャットへ出さない。
3. 固定previewだけに新規変数を追加し、未ログイン・非購入・PROだけ・購入済み・通知期限切れ・失効・別人・障害・認証改ざんを実確認。架空ユーザーの権限行と実購入は区別する。
4. RAM/CPU/通信/初回起動時間を測り、月額予測を報告。秘密非表示とDBの非公開を再確認し、Claudeへ到達できた入口と未確認項目を渡す。

### Claudeへ渡す説明

画面・ツールは同一オリジンのGET /api/resolute/entitlementsだけを呼んでください。応答JSONは前の仕様から変えません。use/alertsを別々に読み、canUseToolsでツール利用、canReceiveNotificationsで通知権限を表示してください。PROによる迂回はありません。401はログイン、503は一時的に権限を確認できない表示にし、未購入と区別してください。RailwayのURL・DB情報・サービス間秘密鍵を画面コードへ埋め込む必要はありません。計画保存のエンドポイントはデータ項目を照合してから別途共有します。現時点では専用APIは未作成、実DB接続は未確認で、実環境で200が返る完成状態とは扱わないでください。

### 確認資料

- Railway料金: https://docs.railway.com/pricing/plans
- 算定式: https://docs.railway.com/guides/right-size-cpu-memory
- 非公開通信: https://docs.railway.com/networking/private-networking
- Serverlessの睡眠条件/初回502: https://docs.railway.com/deployments/serverless
- Clerk JWT検証: https://clerk.com/docs/reference/backend/verify-token と https://clerk.com/docs/guides/sessions/session-tokens

今回の変更は文書末尾への追記だけ。既存本文のバイト保持、git diff --check、Git Dataとlocal treeの一致を確認して公開する。


## 2026-10-10 ChatGPT — 専用API実装・配置の進行状況

ユーザーは専用API追加分月1〜3ドル、バックアップ込み月1.1〜3.5ドルの見込みで、専用API作成、RESOLUTE用DBのスキーマ適用、Vercel対象プレビューへの新規変数追加を承認した。Hobbyのまま進める。

- Vercel側の `/api/resolute/entitlements` はClerk認証後に `getToken()` で取得したセッションJWTを専用APIへ渡す。ブラウザのuserId・PRO・管理者指定は使わない。専用認証キーはサーバー内だけで使う。
- Railway用Node 24 APIは `services/resolute-api/`。署名・期限・発行元・許可origin・session IDを検証し、JWTの本人IDでだけ権限を読む。DB読取は `lib/resolute/database.ts`。API起動・HTTP経由ではDDLを実行しない。
- APIは1台、メモリ上限0.25GB、CPU上限0.25、Serverless有効、ボリュームなし。上限は請求上限ではない。実測値と費用見込みは配置後に確認する。
- Railwayの新規サービス `resolute-api`（7108edd6-952c-474a-8ed6-97482be50c2b）に `ENTITLEMENT_DB_URL`、`RESOLUTE_API_SERVICE_TOKEN`、`RESOLUTE_CLERK_JWT_PUBLIC_KEY`、`RESOLUTE_CLERK_ISSUER`、`RESOLUTE_CLERK_AUTHORIZED_PARTIES`、`PORT` を設定済み。値は本書に記載しない。
- Vercel `tech-phase-lab` のpreview / `codex/research-preview` だけに `RESOLUTE_API_URL` と `RESOLUTE_API_SERVICE_TOKEN` を新規追加済み。productionや既存変数の値は変更していない。
- 新規一回実行ジョブ `resolute-db-provision`（ab53b28a-62ef-4e0e-9626-0dabb5206cf9）はスキーマと読取専用roleを作り、購入状態・通知期限切れ・失効・他人・書込拒否・reader接続を実DBで検証する。テスト権限は同一トランザクション内でロールバックする。ソースは `scripts/resolute/provision-reader.mjs` と既存migrationから生成する。
- このDB適用ジョブのステージ済み変更は、新規ジョブと専用変数だけで、既存サービス変更を含まないことを読み取りで確認した。ただし適用ツールは「承認されずキャンセル」と返したため、DB適用は未実行。確認前にschema適用済み・実接続完了とは扱わない。
- 既存バックアップの手動再実行も自動レビューにより拒否され、実行していない。2026-10-10 11:35 UTCの既存バックアップ成功ログを読み取りで再確認した（暗号化2,286 bytes / dump 2,086 bytes / 1.083秒）。今回のDDLやテスト権限書込はまだない。

### Claudeに渡す説明

画面は `GET /api/resolute/entitlements` のままで接続できます。RailwayのURL、DB接続文字列、専用キーを画面コードに入れる必要はありません。`use` と `alerts` は独立して表示し、利用可否には `canUseTools` と `canReceiveNotifications` を使ってください。PROだけでは許可しません。401はログイン案内、429は再試行を待つ案内、503は一時的に確認できない案内にし、503を未購入表示へ変換しないでください。

現在は実装済みですが、DB適用とVercel経由のログイン済み200応答は未確認です。実環境の接続完成扱いは、その確認結果が追記されるまで保留してください。計画データの保存API・決済付与・商品通知は本変更の対象に含まず、これから別途実装します。

検証: Node 631本 / Python 2,368本成功、lint 0 errors（既存warnings 2件）、Next.js build成功、compileall成功。今回の変更範囲はRESOLUTE専用コードとdocsのみ。


## 2026-10-10 ChatGPT — API配置後の確認結果

- 実装コミット: `01bfd4708c39f8ddf7edb1c33d4da9f39e3d5d11`。Railwayの `resolute-api` はこのコミットに固定し、以降のdocs追記だけでは再デプロイしない。
- Railway deployment `1aadf9a4-a979-43c5-8adc-10f38b43b35d` はSUCCESS。`/healthz` の200、認証なし401、不正JWT（正しいサービスキーあり）401、userIdクエリ指定404、POST 405を公開HTTPSで実測確認した。すべて `Cache-Control: private, no-store`。この検証はDB接続の証明ではない。
- 起動直後のメモリ使用量: 0.042770432 GB（約43MB）。1時間平均には起動前のゼロが含まれるので、その平均値で月額を過小計算しない。実DB・Clerkの正常認証・本番負荷はまだ含まない。承認済み月1〜3ドル（バックアップ込み1.1〜3.5ドル）の試算は据え置き、接続完了後24〜48時間の使用量から見直す。
- Vercel preview deployment `dpl_9fJBPF5X889oViCwMHPwAd2JYTRg` は同じ実装コミットでREADY。接続変数はこのpreviewへ反映対象として作成済み。
- 保護されたVercelプレビューの取得ツールは `deployment_authentication_required` / 401を返した。これはVercel保護段階での失敗であり、アプリの未ログイン401やDB読み取り結果とは扱わない。ローカルVercel CLI認証もない。保護設定は変更していない。
- 残り: ステージ済み新規 `resolute-db-provision` の適用、実DBのスキーマ・reader role・ロールバック検証、Vercelのログイン済みセッションからの200確認。必要なブラウザ操作の範囲は新規ジョブ適用と対象プレビュー確認に限定する。既存サービス・DB・変数・請求・プランは対象外。
- Claudeは前項の画面側契約で作業を進められる。接続完成の報告は上記3点の実測確認後に行う。秘密情報を受け渡す必要はない。
