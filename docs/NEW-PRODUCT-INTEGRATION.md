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


## 2026-10-10 ChatGPT — DB適用完了と一回用ジョブの復旧

- 新規 `resolute-db-provision` の専用ステージ変更だけをブラウザで適用した。初回は12:54:10 UTCに `RESOLUTE_PROVISION_OK`。専用DB `resolute` にschema/tableと `resolute_api_reader` を作成し、購入済み・通知期限切れ・利用権失効・別人・書込拒否・readerログインを実DBで確認した。架空ユーザーの検証行は同一トランザクションで全件ロールバックし、残存なしを確認した。実ユーザーへの購入権付与は行っていない。
- 初回成功後、ChatGPT側のリソース上限/配置設定変更で同じ一回用ジョブを再実行させてしまった。12:54:48 UTCに既存tableを検出する重複適用ガードで停止し、CRASHEDとなった。DBの再作成・再適用は実行されず、API/DBのdeploymentはSUCCESSのまま。この停止が今回のクラッシュ通知の対象として確認できた。
- 同ジョブを `scripts/resolute/verify-reader.mjs` から生成した読み取り専用確認コードへ置換した。再実行時もDDL・GRANT・パスワード変更・権限行の書込を行わず、readerとして接続しSELECTだけで状態を検証する。元の一回用適用スクリプトは明示的な初回適用専用のまま残す。
- 修正deployment `bddc6fbc-1d40-4a4d-9550-72a78b610349` はSUCCESS、画面はCOMPLETED。13:01:20 UTCの `RESOLUTE_READER_VERIFIED` でreaderログイン・schema読取・書込権限なし・管理者権限なし・検証行残存なし、writes=0を実確認した。restartPolicyはNEVER、定期実行なし、HTTP公開なし。正常終了後の常駐処理はない。
- 専用API `resolute-api` とPostgresは稼働中。DBは引き続き非公開。既存ニュース監視、他DB、既存変数、請求/プラン設定は変更していない。新規ジョブの専用変数名は `RESOLUTE_SETUP_DB_URL` と `RESOLUTE_READER_PASSWORD`（値は記録しない）。
- Vercel経由のログイン済み200応答は未確認。ブラウザの対象previewアクセスは `ERR_BLOCKED_BY_CLIENT`、続く操作はブラウザURLポリシーで拒否された。迂回や保護設定の変更は行わない。これはAPI/DBの故障を示す結果ではないが、画面→Vercel→Railway→DBの通し検証の代わりにもならない。
- 費用は承認済みのAPI追加月1〜3ドル（バックアップ込み1.1〜3.5ドル）の試算を据え置く。24〜48時間の正常認証/読込を含む使用量は未取得なので実測確定額とは扱わない。バックアップのschema適用後の取得/復元結果もまだ確認していない。

### Claudeへ渡す接続説明（今回の確認結果）

画面は同一originの `GET /api/resolute/entitlements` だけを呼んでください。Railway URL、DB情報、サービス間キーを画面へ渡す必要はありません。`use` と `alerts` を別々に読み、`canUseTools` と `canReceiveNotifications` で判定します。PROは購入権限を代替しません。401はログイン、429は待機、503は一時的な確認不能として表示し、未購入と混同しないでください。

専用DBの適用と実DB検証は完了しました。Vercelログイン済みセッションでの200、計画保存API、決済Webhookによる付与/更新、商品メール送信は未確認または未実装です。画面契約に沿った制作は進められますが、これらを接続完成扱いにはしないでください。

補足: 修正後の読み取り確認で専用APIはServerlessの `SLEEPING`、Postgresは `SUCCESS`。APIの睡眠は待機時の状態として設定したもので、今回のCRASHEDとは別。HTTP起動後の正常認証200と初回起動時間は未確認。ローカル検証はNode 634本成功、lint 0 errors（既存warnings 2件）、Next.js build/compileall/diff check成功。Python全テストの結果は完了確認後に記録する。

追加実測: Serverlessの睡眠確認後、公開 `/healthz` へのGETは200、JSON `{"status":"ok"}`。クライアントからの所要時間10.407864秒（通信/起動を含む。API処理時間だけとは扱わない）。正常認証した権限APIの200の代わりにはならない。

最終ローカル検証: Python 2,368本成功（206.217秒）、Node 634本成功、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。


## 2026-10-10 ChatGPT — 言語・タイムゾーン保存API

前回のDB復旧コミット `82a35b2330c3a23a66a7172cac8437596eb782da` のGitHub Actions（run 38054385093）はcompleted/successを確認した。以下は会員設定のAPI実装であり、商品メール送信や画面からの実環境検証の完了ではない。

### Claudeが画面に接続する契約

- 入口は同一originの `GET /api/resolute/preferences` と `PUT /api/resolute/preferences`。既存Clerkセッションで本人を識別する。userId・PROフラグ・購入権限をリクエストで渡さない。
- 保存先は既存合意どおりClerkのpublicMetadataの `locale` と `timezone` だけ。Clerk BackendのupdateUserMetadataで部分更新し、他のpublicMetadata、privateMetadata、unsafeMetadataを上書きしない。設定変更で購入権限やメール配信同意を付与しない。
- GETの200例: `{"locale":"ja","timezone":"Asia/Tokyo","configured":true}`。両方未設定/不正の例: `{"locale":null,"timezone":null,"configured":false}`。片方だけ有効なら有効な項目は返し、不正/未設定の項目はnull。メール、他metadata、userIdは返さない。
- PUTは `Content-Type: application/json`、同一originで `{"locale":"en","timezone":"America/New_York"}` の2項目を必ず送る。正常保存後はGETと同じ形を返す。ja/en以外、UTC/IANAタイムゾーン以外、余分なキー、null、配列、不正JSONは拒否する。IANAの別名は実行環境のIntlによる正規名へ統一する。UTCも受け付ける。UTCオフセットだけの文字列は受け付けない。
- GET/PUTの401はログイン案内。PUTの400は入力確認、403はorigin不一致、413は本文1,024 bytes超、415はJSON以外。Clerk/認証障害・保存結果確認不能は503 `PREFERENCES_UNAVAILABLE`。全GET/PUT応答はprivate/no-store。他人の設定や秘密情報を含むエラーは返さない。
- 未設定時に日本語/日本時間を通知用の保存値として勝手に選ばない。画面で候補を提示し、本人が保存してconfigured=trueを確認してから通知ジョブとの接続を進める。現時点で通知ジョブはこのAPIへ接続していない。
- 設定は無料/PRO/RESOLUTE未購入でも本人なら読み書きできる一般的な会員設定。商品利用や通知利用の判定は別の `/api/resolute/entitlements` を使い続ける。
- 設定画面本体への組み込み、Clerk実ユーザーへの保存/再読込、日英画面とメールへの反映は未検証。今回、実ユーザーのmetadata変更やテストメール送信はしていない。新たなサービス・変数・有料契約は不要。既存契約のAPI使用量は増えるため、追加費用ゼロの保証ではない。

### 計画保存APIの着手に必要なClaude素材

計画保存は同じ非公開RESOLUTE Postgres内の別テーブルを予定する。次にClaudeから計画データのTypeScript型またはJSON例（ルール、各ラインの意味、保有理由、銘柄識別子、通貨、数量/金額/価格の精度、入力の上限）を受け取り、保存APIの検証項目と照合する。一人の計画数、編集/削除、保存期間の条件も記載してほしい。まだ項目を推測したテーブルや書込roleを本番DBに作らない。本人認証・有効なuse・所有者確認・versionによる更新競合検知は必須とし、通知利用権の期限切れだけで計画の閲覧/編集を止めない。

公式確認資料: https://clerk.com/docs/reference/backend/user/update-user-metadata （publicMetadataの部分更新/深いマージ）。

補足: 専用設定画面は今回未作成。既存ホーム/メニュー/言語切替の変更はしていない。保存APIの実装と、画面への組み込み完了は区別する。前回コミットのVercelプレビューは deployment dpl_AnmBinP71zvQqJDgya5tzJa4H7Vu / READY を確認したが、正常認証した権限API応答の検証ではない。

検証結果: Node 639/639、Python 2,368/2,368（210.544秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。実ユーザーのClerk読書きと設定画面の通し検証は未実施。


## 2026-10-10 ChatGPT — RESOLUTEの言語・タイムゾーン設定画面

言語・タイムゾーンを本人が保存する専用画面 `/resolute/settings` を追加した。日英共通パスで、表示言語の切替と保存するlocaleの選択を分ける。未設定のlocale/timezoneは空欄にし、自動保存しない。「端末のタイムゾーンを使う」は入力候補の設定だけで、保存ボタンを押すまで永続化しない。

通信は既存の同一origin `GET/PUT /api/resolute/preferences` の契約をそのまま使用する。読込・保存中と認証確認中は保存を止める。アカウントのセッションが変わった場合は入力をリセットして再読込する。ClerkProviderを専用ページ内に置き、既存のresearchレイアウトやホーム・メニューは変更しない。未ログインは既存の `/research/account` へ案内する。取得失敗と未設定を分け、保存失敗時は入力を残す。応答の設定値が送信値と一致しない場合は保存成功と表示せず、書込の自動再試行もしない。

ブラウザにはRailway URL・DB接続情報・サービス間キーを渡さない。ブラウザ用の純粋な入力検証を `preferences-data.ts` に分け、サーバー側のHTTP処理を読み込まない。購入・PRO・通知利用権の契約は変更せず、設定保存だけではメール配信や通知利用権を開始しない。新しいサービス、環境変数、契約は追加していない。

Claude向け: 設定画面は `/resolute/settings` を利用できる。計画ツール側に設定保存処理を重複実装する必要はない。設定APIと権限APIは引き続き別であり、計画ツールは `use`、通知は `use` と有効な `alerts` の両方を確認する。計画データの型・JSON例を受け取るまで本番DBの計画テーブルや書込roleは作成しない。

確認の範囲: ローカルの通信テストでは同一originのGET/PUT、応答不整合、認証/入力/通信障害、失敗時の自動再試行なしを確認する。実際の画面表示・スマートフォン操作・ログインした実ユーザーでの保存/再読込は未検証。前回のブラウザアクセスがポリシーでブロックされたため、別URL等で回避していない。VercelのREADYとGitHub Actionsの成功だけで、この通し検証を完了扱いにしない。今回、実ユーザーのmetadata変更とテストメール送信は行っていない。

最終ローカル検証: Node 643/643、Python 2,368/2,368（191.788秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --cached --check成功。前回の保存APIコミット `f9967daa6323852dcd34d7371c3f4ffaab32ebd2` はGitHub Actions run 38055516418のsuccessとVercel deployment dpl_EjJMWxbxuYKdeyhz2uF6JgPMKMR3のREADYを確認済み。今回の画面の実ログイン/保存/再読込は未確認。

統合後の再検証: 別担当のウォッチリストCSSコミット `66e0620967ca43e9086c5a8f2aafeae8ad6f8720` をそのまま含めた状態で、Node 643/643、Python 2,368/2,368（223.006秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、diff checkが成功。ChatGPT側からウォッチリストCSSの追加編集は行っていない。


## 2026-10-12 ChatGPT — Claude回答の計画計算と保存契約

Claudeから計算式・制約の回答を受領した。以下は計画保存APIに向けた接続契約であり、DBへの保存・削除や商品画面の接続が完成したという報告ではない。未決のanswersと閲覧条件を確定扱いにしない。

### 金額計算

- 金額はJPY=円、USD=セントの整数で、入力は0〜10^12最小単位。USDも小数を入力しない。月数は小数1桁、reserveMonthsは0〜120、savingsMonthsは0〜600。割合は小数1桁で0〜100、買付ラインのdropPctだけは0より大きく99.9以下。fx.usdJpyは小数2桁で50〜500。
- reserve = floor(monthlyLivingCost × reserveMonths)。investable = max(0, financialAssets − reserve − nearTermExpense)。financialAssetsは現金と投資済み資産の合計で、nullならinvestableもnull。前の暫定Plan型のinvestable:numberをnumber|nullへ修正する。
- investBaseはinvestedAmountがnullでなく正数ならinvestedAmount、それ以外はinvestable。保存せず毎回計算する。toleranceDrop = floor(investBase × tolerancePct / 100)、buyBudget = floor(investBase × buyBudgetPct / 100)。基準額または各割合がnullなら結果もnull。
- toleranceMonthsはtoleranceDrop / monthlyLivingCostを小数1桁で切り捨て、生活費が0なら非表示。toleranceDropがnullなら非表示。buyBudgetとtoleranceMonthsは表示用で保存しない。investableとtoleranceDropは保存時にサーバー再計算して一致を確認し、不一致は400にする契約。
- 共通の純粋な計算をlib/resolute/plan-calculation.tsに実装した。金額の乗算/切り捨てはBigInt、月数/割合は10倍した整数で扱う。calculatePlanAmountsにはcurrency、monthlyLivingCost、reserveMonths、nearTermExpense、financialAssets、investedAmount、tolerancePct、buyBudgetPctの8項目だけを渡す。assertPlanCalculatedAmountsで送信されたinvestable/toleranceDropの一致を確認できる。
- このモジュールは計算入力だけを検証する。savingsMonths・fx・buyMode・文字配列などを含むPlan全体の検証器やHTTP APIではない。通常/未回答/全未回答/投資可能額0のJPY例、USDセント、精度境界、入力不正、計算値改ざんをローカルテストする。税金計算テスト20本の検証とは別。

### 買い増しと更新/削除の接続契約

noneはbuyLines空、buyBudgetPct/allocationはnull。singleはライン1件、allocationはnull。stepsは2〜10件、allocationはequal/heavier。質問画面は最大4段階、計画ツールで最大10に編集可能。dropPctは昇順・重複なし、amountは共通の金額単位。amount合計がbuyBudgetを超えても保存は拒否せず画面で警告する。none以外のbuyBudgetPctがnullの場合の警告表示と、予算未算出時の表示は画面仕様として確認する。条件配列は各最大10件・1件100文字、fx.noteは200文字まで。

1ユーザー1計画、本人認証、購入のuse確認、所有者確認を前提とする。未作成GETは{plan:null,revision:0}、初回PUTはbaseRevision:0、競合409は最新のplan/revisionを返す。createdAt/updatedAt/revisionはサーバー管理。DELETEの対象は本人の計画データとanswersで、購入履歴・利用権は削除しない。削除後は有効なuseがあれば再作成可能。削除を許可する権限状態、削除直後のrevisionと再作成時の競合/古いリクエスト対策、バックアップ復元時の削除情報の再適用はまだ実装していない。

### 未決・現行APIとの違い

- answersは質問ID・型・選択肢・保存理由の一覧をClaudeから受領するまで保存する実装を作らない。計画テーブル/書込role/PUT/DELETEを本番DBに追加していない。
- 通知期間終了後も、有効な買い切りuseがあれば閲覧・編集・シミュレーションは継続できる。PROは商品権限判定に使わない。
- Claude案のuse.expiredで閲覧だけ許可、revoked/not_ownedで閲覧不可はオーナー未確認。現行のuseにはexpiresAt:nullという制約があり、use.expiredは通常データでは作れない。未購入のAPI上の状態名はmissingで、not_ownedではない。この変更にはDB/API契約との整合が必要で、今回の計算実装では権限を変更していない。

### 削除とバックアップ保持の事実・表示案

現行scripts/resolute/backup.pyの保持ロジックは、成功したバックアップの直近7つの異なる日付について各最新1件と、直近4つのISO週について各最新1件の和集合。重複を除くため最大11件。同日再実行で日数を減らさない。経過日数による強制消去ではなく、新しいバックアップの成功時に古い保存分を整理する。停止/失敗が続くと古いバックアップが残るため「削除から最大28日以内に必ず消去」とは表示できない。通常の毎日成功を前提にすると日次7日分＋週ごとの最新4回分という目安になる。

10月10日に記録した手動バックアップ/隔離DB復元の成功は確認済みの記録として保持する。10月11日の日次Cron結果、10月12日の週次Cron、今回時点のBucket内容・実際の最古データの日付は再確認していない。計画テーブル適用後の取得/復元も未確認。本番DBやバックアップの設定・保存物を今回変更/削除していない。

購入者への表示案: 「計画を削除すると、保存した計画と回答が通常の利用画面から削除されます。購入履歴と利用権は残ります。復旧用の暗号化バックアップには削除前のデータが残ることがあります。バックアップは直近7日分と週ごとの最新4回分を目安に保管し、新しいバックアップの成功時に古いものを整理します。」この文はDELETE実装前の案であり、削除完了の表示にはまだ使用しない。復旧時に削除済み計画を通常データへ戻さない仕組みはDELETEと合わせて設計・確認する。

検証結果: Node 680/680（計画計算の追加6テストを含む）、Python 2,400/2,400（164.933秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --cached --check成功。これは計画の保存/削除・実画面・実DBやバックアップ最新実行の検証ではない。


## 2026-10-12 ChatGPT — 計画権限・削除revisionの確定とfx保留

Claude経由の最新回答を受領した。この追記は直前の暫定記述に優先する。既存本文は変更しない。

### 確定した接続契約

- Planのinvestableはnumber | null。financialAssetsがnullならinvestableもnull。既存の共通計算モジュールはこの契約に対応済み。
- 買い切りのuseは期限なしでexpiresAt:null。計画の閲覧・編集・シミュレーションはuse.statusがactiveのときだけ許可する。revokedとmissingは閲覧も不可。未購入の状態名はmissing。use.expiredは通常発生しないため例外時の扱いは保留し、閲覧許可へ流用しない。通知利用権alertsの期限終了だけでは、有効なuseによる計画利用を止めない。PROは商品権限を代替しない。
- PUTは{plan, baseRevision}、DELETEは{baseRevision}。本人をサーバー側の認証から識別する。baseRevisionは0以上の安全な整数。createdAt、updatedAt、revisionはサーバー管理。未作成GETは{plan:null,revision:0}、初回PUTはbaseRevision:0。権限・本人確認を競合応答より先に行い、閲覧不可の利用者に409の最新計画を漏らさない。
- DELETEでは計画データとanswersを削除し、削除済みの印にはユーザーID・revision・削除日時だけを残す。購入履歴と利用権は別で保持する。更新と削除は同じrevisionを使って原子的に競合判定し、削除のたびにrevisionを+1する。既にplan:nullの場合も、正しいbaseRevisionで受理したDELETEは+1し、0に戻さない。古いbaseRevisionは409と最新のplan/revisionを返す。権限確認に失敗した場合は最新計画を返さない。
- 削除後のGETは{plan:null,revision:現在の値}。再作成PUTにはその値をbaseRevisionとして使い、作成時もrevisionを増やす。削除前の古いPUT/DELETEは409とし、削除済み計画を復活させない。
- DELETEの非active利用者への受付条件はまだ確定していない。今回の回答は閲覧・編集・シミュレーションの条件を確定するもので、取り消し後の本人によるデータ削除請求の導線を閉じる決定とは扱わない。DELETE実装前に受付条件を確認し、不可視の計画をエラー応答へ含めない。

### answersとfxは実装保留

answersは30問確定後の質問ID・型・選択肢・保存理由の一覧を受領するまで永続化を実装しない。fxは質問内容の変更に伴い持ち方を再提示するため、検証・計算・保存・画面接続の実装を止める。前節のfx.usdJpyの範囲/精度とfx.noteの文字数は現時点の確定仕様ではなく、新しい回答で再確定する。現行の共通計算はfx/answersを入力に含めず、計画保存APIやDBテーブルもまだ作成していない。

### バックアップ復元時の削除優先（未実装の設計案）

DBの削除済みの印だけでは、削除前のバックアップから復元した際にその印自体が失われる。削除履歴を復元対象DBのスナップショットとは別の永続保存先にも残し、復元時に最新の履歴を再適用する構成が必要。保存項目はユーザーID・削除revision・削除日時だけで、計画本文やanswersを含めず、アクセス制限と暗号化を行う。

復元は隔離DBで行い、削除revision以下の復元計画は消去する。削除後に再作成され、そのrevisionが最新削除revisionを上回る計画は一律に削除しない。行がなければ削除済みの印を再作成し、revisionを後退させない。履歴の取得・照合・再適用が確認できるまで復元DBを利用者へ開放しない。DELETEと外部履歴への記録の間の障害も考慮し、耐久性のある再送・未反映検知と、削除を完了扱いにする条件を実装前に確定する。

これは設計案であり、独立した削除履歴保存先、再送処理、復元時の再適用は未実装。既存のpg_dump/隔離DBへのpg_restore成功は、この削除保護の検証を意味しない。追加保存先の容量・費用を確認してから設定する。DBとBucketが同じRailwayアカウント内にあるため、アカウントアクセス喪失に備える別保管は引き続き課題。

バックアップ保持は「直近7日分＋週ごとの最新4回分を目安」とし、「28日以内に必ず消える」とは記載しない。前節の購入者向け削除表示案は了承済みで、法務確認時に最終文面を修正する。DELETE実装前に削除成功の表示として使用しない。

今回の作業は仕様資料への追記のみ。実DB、Railwayサービス/変数/費用、既存ニュース監視、メール送信は変更していない。検証はgit diff --checkと既存本文がそのまま残ることの照合。計画保存・削除API、独立削除履歴、削除後の復元保護は未実装であり、完成扱いにしない。


## 2026-10-12 ChatGPT — 計画保存・削除APIの先行実装（answers/fxを除外）

最新回答により、本人のDELETEはuse.revokedでも許可する。missingでも本人認証後は成功応答を選択し、閲覧・編集・シミュレーションは引き続きuse.activeのみ。技術的な細部はChatGPT側で決めて進め、確認は費用・個人情報・利用者に見える文言に関わる事項に限る。この追記は前節のDELETE受付条件の未決記述に優先する。

### Claudeが画面を接続する契約

入口は同一originのGET/PUT/DELETE /api/resolute/plan。内部ではVercelサーバーがClerkセッションJWTと既存サービス間トークンを使ってRailwayの/internal/v1/planを呼ぶ。ブラウザからuserId・購入権限・PRO状態・Railway URL・秘密情報を渡さない。GET/PUTには有効な買い切りuseが必要。DELETEは本人認証だけで受付し、useの取り消し・未購入でも自分のデータ削除を止めない。

PUTは{plan,baseRevision}、DELETEは{baseRevision}。初回は0。200と409は共に{plan,revision}で、DELETEの200はplan:null。GETの未作成はplan:null/revision:0、削除後は保持したrevision。PUT/DELETEの成功でrevisionを+1する。既にplan:nullや未購入でデータがない場合も、正しいbaseRevisionのDELETEを成功として受理し、削除済みの印と次のrevisionを保持する。権限取り消し後はGETできないため、DELETEで競合したら409のrevisionを使って本人が再実行できる。非active本人のDELETEの409はplan:nullにしてrevisionだけ返し、不可視の計画本文を漏らさない。書込の自動再試行はしない。応答を受け取れなかった場合は保存失敗と断定せず、GETまたは本人による競合確認で結果を確認する。

Planの入力型はlib/resolute/plan-data.tsのPlanInputが正本。schemaVersionは1。現時点の保存項目はcurrency、monthlyLivingCost、savingsMonths、reserveMonths、nearTermExpense、financialAssets、investedAmount、investable、tolerancePct、toleranceDrop、perStockCapPct、buyMode、buyLines、buyBudgetPct、allocation、noBuyConditions、haltConditions、ruleType。全項目を送る。nullable項目はnullを明示する。金額計算・上限・精度・買い増し制約は前節の確定事項を検証し、investable/toleranceDropの不一致は400。買い増し額の合計がbuyBudgetを超える入力は拒否しない。条件の文字数はUnicodeコードポイントで数える。

answersとfxはキー自体を受付せず、送信されたら400。createdAt/updatedAtも入力では送らない。GET/PUTのplanにはサーバー管理のcreatedAt/updatedAt（ISO UTC）が含まれるため、編集してPUTする際はこれらを除く。revisionはplanの外側で扱う。表示用のreserve/investBase/toleranceMonths/buyBudgetは保存項目に追加せず、既存共通計算を使う。計画内容やメールアドレスをエラー・ログへ出力しない。

GET/PUT/DELETEの401はAUTH_REQUIRED、GET/PUTの403はPLAN_ACCESS_DENIED、PUT/DELETEのorigin不一致はORIGIN_REJECTED、400はINVALID_PLAN、413はBODY_TOO_LARGE、415はJSON_REQUIRED、429はRATE_LIMITED（Retry-After:60）、503はPLAN_UNAVAILABLE。本文はapplication/jsonで最大16,384 bytes、URLのクエリによるユーザー選択等は受付しない。全応答はprivate/no-store。503を未購入や保存成功と表示しない。今回、画面の文言変更は行っていない。

### DB・削除・復元の実装と有効化条件

明示適用用db/resolute/002_plans.sqlを追加した。専用resolute DB以外では適用を拒否する。1ユーザー1行で、更新・削除はトランザクションとユーザー単位のDBロックで直列化し、baseRevisionを照合する。useの確認はDBで行い、PROや通知期間を代用しない。DELETEは計画本文をNULLにし、作成/更新日時も消去してユーザーID・revision・削除日時を保持する。購入履歴・利用権には書き込まない。同じトランザクションでplan_deletionsへユーザーID・revision・削除日時だけを記録し、記録失敗なら削除全体をロールバックする。

lib/resolute/plan-restore.tsに削除履歴の再適用処理を追加した。resolute_restore_testという隔離DB以外には実行できない。独立保存先から取得・復号・完全性を確認した最新履歴を渡す前提で、削除revision以下の復元計画を削除済みの印へ置換し、欠けた印を再作成する。削除後に再作成され、削除revisionより新しい計画は保持する。不正履歴を受付せず、再適用によってrevisionを後退させない。

plan_deletionsが復元スナップショット内にあるだけでは削除保護を保証できない。独立した暗号化履歴への出力・読戻し・障害時の再送・完全性確認と、既存pg_restoreジョブへの接続は未実装。このため本番の計画APIは既定で無効（503）。RailwayのRESOLUTE_PLAN_API_ENABLEDをtrueにする前に、独立削除履歴と復元確認を完了する。DB接続は将来の専用変数RESOLUTE_PLAN_DB_URLだけを使い、resolute_plan_writerという限定roleを要求する。既存ENTITLEMENT_DB_URL/resolute_api_readerはそのまま読取専用で維持し、他DBやDATABASE_URLへフォールバックしない。

今回、本番のSQL適用・writer作成・環境変数設定・有効化はしていない。新しいサービス・契約・費用設定・メール送信は追加していない。費用を伴う独立保存先の設定は見込みを確認してから行う。独立履歴と復元保護、実画面からVercel/Railway/実DBへの通し確認を終えるまで「計画保存・削除が本番で完成」とは扱わない。answers/fxの最終仕様を受領後、保存範囲を再確認して追加する。

### 確認済みと未確認

ローカルPostgreSQLエンジンでSQL適用、未作成、保存、競合、削除、再作成、取り消し後の閲覧/編集拒否と本人削除、未購入本人の削除、削除記録失敗時のロールバックを確認した。隔離DBで古い計画の削除履歴再適用、新しい再作成計画の保持、欠けた削除済みの印の復元、再適用の冪等性、不正履歴と別DBの拒否を確認した。HTTPテストで本人識別・origin・入力上限・競合応答・秘密を含まないエラー・書込再試行なしを確認した。これはRailwayの実DBでの保存や、実Bucketの独立履歴を使ったpg_restoreの実測結果ではない。

検証結果: Node 685/685、Python 2,400/2,400（156.300秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。実際のNode HTTP起動・署名JWT認証・DELETE本文転送・本番無効時の503もローカル確認済みで、DBへは接続していない。最初のPython実行は既存test_deep_analysisの全文文字列検査がpublishedAtの45秒を45%と誤検出して1件失敗した。対象外のニュース実装/テストを変更せず、全体再実行の成功を確認した。


## 2026-10-12 ChatGPT — 計画APIの最小DB権限を再確認

計画writerにはentitlementsのSELECTだけを付与し、INSERT/UPDATE/DELETEは付与しない。PostgreSQLのSELECT FOR SHAREはUPDATE権限も必要になるため、権限確認クエリから行ロックを除いた。専用DBの明示適用用002_plans.sqlには、entitlementsのINSERT/UPDATE/DELETEも計画処理と同じユーザー単位のadvisory transaction lockを取得するtriggerを追加した。これにより購入権限を書き換える権限を計画APIへ与えずに、購入権限の変更と計画処理を直列化する。entitlementsのユーザーIDの変更は拒否し、別ユーザーへの権限移動をこの更新処理で行わない。

ローカルPostgreSQLの計画テストはresolute_plan_writerの限定roleへ切り替えて実行し、保存・更新・削除の成功と、entitlementsのUPDATEが42501で拒否されることを確認した。既存のAPI読取role、実DB、Railwayの環境変数・サービス設定は変更していない。本番有効化前に独立した削除履歴と復元ジョブを接続する条件は維持する。triggerも本番へ未適用であり、適用後の実DBでの同時実行確認は未実施。

公式参照: https://www.postgresql.org/docs/current/sql-select.html （locking clauseにはSELECTに加えてUPDATE権限が必要）。

最小権限修正後の最終検証: Node 685/685、Python 2,400/2,400（159.378秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。限定roleによる実SQLテストは成功したが、実DBへのmigration/role適用・独立削除履歴の出力/読戻し・pg_restoreジョブ接続・画面からの実環境検証は未実施。


## 2026-10-12 ChatGPT — 30問のanswersとfx最終仕様を受領・実装

Claudeから質問30問と保存仕様の確定回答を受領した。この追記は前節の「answers/fxは受付しない・実装保留」に優先する。既存本文はそのまま残す。PlanInputへanswersVersion:1、answers、fxを追加し、APIの保存・読込・入力検証のコードを更新した。タイプとアドバイスの判定はClaude側の純粋関数が担当し、サーバーはruleTypeの既存enumを検証して参考値として保存するだけ。再計算や分類ロジックは追加していない。金額の既存再計算・権限判定・競合revisionの契約は維持する。

### answersVersion=1の契約

answersはq01〜q30の全30キーを必須とする。出さなかった質問と未回答はnull。省略・余分なキー・undefined・数値・自由記述は受付しない。単一選択は選択肢IDの文字列、q21/q28/q29だけは選択肢IDの配列。配列は重複なしで1件以上、それぞれ選択肢数を上限とする。何も選んでいなければ空配列ではなくnullにする。

選択肢の正本はlib/resolute/plan-answers.tsのPLAN_ANSWER_OPTIONS。PlanAnswers型も公開し、emptyPlanAnswers()で全30キーがnullの初期値を作れる。parsePlanAnswersは保存形式の検証だけを行い、タイプ判定は行わない。

| 質問ID | 選択肢ID |
| --- | --- |
| q01 | first / 1to3 / 3plus |
| q02 | l15 / l25 / l40 / l40plus / custom |
| q03 | stable / uneven / none |
| q04 | m0 / m1 / m3 / m6 / m12 / custom |
| q05 | m3 / m6 / m12 / custom |
| q06 | none / has |
| q07 | input / unknown |
| q08 | not_yet / input |
| q09 | y3to5 / y5to10 / y10plus / undecided |
| q10 | often / sometimes / rarely / no_drop_yet |
| q11 | p10 / p20 / p30 / p40plus / unknown |
| q12 | no / yes / no_drop_yet |
| q13 | wait / buy_more / reduce / unknown |
| q14 | never / once / often / no_rally_yet |
| q15 | hold / sell_some / buy_more / undecided |
| q16 | steady / fast / defensive / undecided |
| q17 | monthly / on_drop / on_rise / news / undecided |
| q18 | many_daily / daily / weekly / rarely |
| q19 | never / sometimes / often |
| q20 | fund_etf / stock / bond / gold / mixed |
| q21（複数） | tech_semis / dividend / healthcare / finance / energy_materials / other |
| q22 | p10 / p20 / p30 / p50 / custom |
| q23 | lt10 / p10to30 / p30to50 / gt50 / none |
| q24 | none / single / steps2 / steps3 / steps4 |
| q25 | d5 / d10 / d15 / d20 / custom |
| q26 | b10 / b20 / b30 / custom |
| q27 | equal / heavier |
| q28（複数） | cash_low / income_unstable / over_cap / no_reason |
| q29（複数） | over_tolerance / cant_sleep / thesis_broken |
| q30 | ignore / yen3 / yen7 / custom |

q21はq20がstock/mixedのときだけ回答可能、それ以外はnull。q25/q26はq24がsingle/steps2/steps3/steps4のときだけ回答可能。q27はq24がsteps2/steps3/steps4のときだけ回答可能。親質問がnullまたは対象外なら子質問もnullを要求する。条件に該当していても未回答ならnullを保存できる。

### 数値とfx

数値の回答はanswersへ入れず、Planの既存数値項目へ入れる。質問から計画を作成するとき、生活費の代表値はl15=150000、l25=250000、l40/l40plus=400000（提示されたJPYの例）。貯金月数はm0=0、m1=1、m3=3、m6=6、m12=12、q11のp40plusは40。customは本人が入力した値を使う。金額の通貨単位は引き続きJPY=円/USD=セントで、サーバーは為替による自動換算や質問の代表値への書換えをしない。その他の代表値とPlan項目への取込みはClaudeの質問画面が担当する。

計画ツールでの数値編集を妨げないため、代表値と現在のPlan数値を一律に同値必須とはしない。サーバーは各項目の型・範囲・精度と金額計算の整合を検証する。ただし明示されたunknown/not_yetの条件は検証し、q07=unknownならfinancialAssets=null、q08=not_yetならinvestedAmount=nullを要求する。これらの金額を後から入力する場合は該当回答IDもinputへ更新する。ruleTypeは選択肢や数値と照合して判定し直さない。

fxは{thresholdYen:number|null,usdJpy:number|null,note:string}の3キーだけ。thresholdYenは0.1〜50で小数1桁、usdJpyは50〜500で小数2桁、noteはUnicodeコードポイントで200文字まで。usdJpyはq30とは独立した入力で、未入力ならnull。q30=ignoreならthresholdYen=null、yen3なら3、yen7なら7、customなら範囲内の入力値を要求する。q30が未回答のnullなら、fx自身の型・範囲を検証し、回答を勝手に生成しない。旧fxの形や余分なキーは400にする。USDの計算入力でもthresholdYenの単位は円で変更しない。

### 自由記述と削除

q28/q29の自由記述はanswersへ入れず、noBuyConditions/haltConditionsへ保存する。各配列は最大10件、各文字列はUnicodeコードポイントで100文字まで。入力欄の表示はClaude指定の「個人が特定できる情報は書かないでください」を使う。ChatGPT側は今回画面の文言を変更していない。

条件本文、回答、fx.noteをログへ出さない。想定外の例外に本文が含まれてもAPI応答へ出さず、一般的なエラーコードだけを返す。商品メールへの接続は今回実装しない。今後の通知ジョブでも自由記述とfx.noteをメール本文へ載せない。保存目的は回答のやり直しとClaude側のタイプ/文章再計算で、メールアドレスをPlanへ追加しない。

保存できるUnicode文字列だけを受け付け、DBのjsonbで保存できないNUL/孤立サロゲートを400にする。不正UTF-8のJSON本文も勝手に置換せず400にする。本文上限16,384 bytes、createdAt/updatedAtはサーバー管理、PUTは{plan,baseRevision}、DELETEは{baseRevision}のまま。DELETEでplan本文をNULLにするためanswersVersion/answers/fxも同時に消える。削除済みの印と独立履歴への引渡しには計画・回答・自由記述を含めない。

### DB適用・確認の範囲

明示適用用db/resolute/003_plan_answers_fx.sqlを追加した。001→002→003の順に専用resolute DBへ適用する。002の暫定的なanswers/fx禁止制約を003で置換し、保存計画にanswersVersion=1とanswers/fxのobject型を要求する。既存のmigration本文は書き換えない。不完全な古い計画が残っていれば制約適用は失敗してロールバックする。回答を推測して補完したり、古い計画を削除して適用を通したりしない。今回の本番DBに計画テーブルを適用していないという前回記録は維持する。

ローカルPostgreSQLの限定roleで回答とfxの保存/読込、DELETEでの消去、同時更新/削除の競合、再作成、削除記録失敗のロールバック、隔離DBへの削除履歴再適用を確認する。回答全30問の選択肢、非表示分岐、バージョン、null、複数選択の型/重複、fxの境界/精度、秘密を含まないエラーも検証する。これらは実Bucketの独立削除履歴や実環境のpg_restoreを確認した結果ではない。

実DBへの002/003適用、writer作成、本番有効化、独立暗号化削除履歴の出力/読戻しと復元ジョブへの接続は引き続き未実施。Railwayの契約・プラン・変数・サービス設定、既存ニュース監視、他DBとメール送信は変更しない。前回コミット4ab29300adaf9dba6cffefe6f5aeea45d1bebb78のGitHub Actions run 38157631781はcompleted/successを確認した。今回の計画APIの本番有効化完了とは区別する。

最終ローカル検証: Node 690/690（回答/fxの追加5テストを含む）、Python 2,400/2,400（159.386秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。Pythonは既存test_deep_analysisの全文検査がpublishedAtの45秒を45%と誤検出する問題を避けるため、RESEARCH_TEST_NOW=2026-10-08T06:00:15+00:00で公式runnerを実行した。初回のデフォルト固定時刻ではこの既存テストだけが失敗した。ニュース関連の実装/テスト/CIは変更していない。本番の保存・削除、商品メール送信、独立削除履歴と実Bucketを使った復元は未検証。


## 2026-10-12 ChatGPT — 最新ZIPの30問・日英画面・保存導線

Claudeの最新版resolute-logic.zip（SHA-256: 6beaa30589839dc0a88bf93e7a51f5c21d21ecf0b1f6282534c704bba46eb50e）を取り込んだ。`/resolute` に30問と結果カード、`/resolute/simulation` に保存済み計画を読む下落・急騰試算を追加。ニュース・目標株価・ホーム・メニューには変更を加えない。詳細と変更履歴は `lib/resolute/README.md`。

この節は旧q01/q25/q26の選択肢表に優先する。answersVersionは発売前の確定版1のまま、q01はfirst/1to3/3to5/5to7/7to10/10plus、q25はd5/d10/d15/d20/unknown/custom、q26はb5/b10/b20/b30/custom。旧q01=3plusを推測で年数帯に変換しない。日本語は添付を基準とし、全30問・選択肢・10タイプ・アドバイス23種・結果と操作案内を英語化。質問の生活費帯が円建てのため、この診断は日英ともJPY。表示言語の切替で金額を換算しない。既存USD計画をこの診断で上書きしない。シミュレーションは保存計画の通貨に従う。

### 未確定ラインと追加数値

q25=unknownや未回答、買い増し予算率未定、基準額がnullの場合は、single/stepsでもbuyLines=[]を許可する。buyModeの意図とbuyBudgetPct/allocationを維持し、値が分からないラインを作らない。noneでは従来どおり空配列・予算率null・allocation null。具体的なラインの金額・順序・個数・精度の制約は維持する。

PlanInputへfirstDropPct?:number|nullを追加。診断画面は常に付ける。予算不明でラインを作れないときも、q25のcustom数値を保存して再編集できる。0より大きく99.9以下、小数1桁、nullは未確定。buyLinesが具体的にある場合は先頭dropPctとの一致を要求する。旧形式で項目がない場合は先頭ラインから読み取り可能。複数段階の入力では最終段階が99.9を超える幅を拒否し、段階数を変えたり100%未満へ切り詰めたりしない。

診断の金額計算はplan-calculation.tsを使う。Claudeの10タイプの採点と同点優先順は維持する。既存ruleTypeの4分類に独自の対応付けを加えず、診断保存時はundecidedを送る。10タイプは保存済みanswersと数値から画面側で再計算できる。サーバー側に分類・文章生成を追加しない。アドバイス条件のみ、選択式の停止条件を見落とさない補正と、最大保有「50%超」だけでは50%超の上限違反を断定しない補正を加えた。

### 画面とAPIの接続

Clerkセッションごとに画面状態を分離し、GET /api/resolute/entitlementsのcanUseToolsを確認して診断・シミュレーションを表示する。PROや通知期間は診断の利用条件に使わない。表示設定はGET /api/resolute/preferencesから取得する。診断画面での日英切替は表示だけで、Clerkの保存設定を変更しない。

GET /api/resolute/planでrevisionを取得し、「このルールを保存する」でPUT {plan,baseRevision}を送る。200のPlanSnapshotとrevision=baseRevision+1を検証して初めて保存成功とし、②への導線を表示する。409は入力を勝手に上書きせず競合を表示。通信失敗・503を成功にせず、自動再送しない。結果が不明な保存後は再送前に保存済みの計画を読み込ませる。シミュレーションページは改めて利用権と保存計画を取得する。GET503の間は、利用権を確認できた人も計画保存・保存済み計画でのシミュレーションはできない。

数値欄は入力を選んだときだけ表示する。q06の金額入力選択は「ある（金額を入力する）」と明記。q28/q29の自由記述には合意済みの個人情報を避ける案内を表示する。未保存回答は画面内メモリのみで、localStorage/URL/ログ/メールには保存・出力しない。自由記述はテキストとして描画し、HTMLとして実行しない。

### 完成扱いしない範囲

計画APIの本番ゲートは維持する。実DBの002/003適用、限定writer設定、独立削除履歴の暗号化出力・読戻し・pg_restoreとの接続、本番の保存・削除・復元通し確認は未実施。APIをtrueに変更していない。Railwayのサービス・変数・プラン・費用設定を変更していない。メールを送っていない。添付の税金/アラート/メールロジックは今回の診断実装に取り込んでいない。


検証結果（今回の最終コード）: Node 749/749、Python 2,400/2,400（125.078秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。Pythonは公式runnerをRESEARCH_TEST_NOW=2026-10-08T06:00:30+00:00で実行した。15秒開始の再確認では既存test_deep_analysisがpublishedAtの45秒を記事の45という数値と誤認して1件失敗したため、対象外のニュース実装・テストを変更せず時刻条件を変えて通し直した。

ローカルのproduction buildをChromiumで操作し、1280px/390px幅、日英30問、入力選択時だけ数字欄が出ること、7結果カード、1回のPUTと保存成功後の②への遷移、q25未確定の保存、409/503で成功や②導線を出さないこと、未購入の遮断を確認した。利用権・設定・計画APIの応答をテスト用に差し替えた画面検証で、実Clerk/Railway/Postgresへの通し確認ではない。通知期間終了・use activeの条件でも画面を使えることを確認した。実環境の保存・削除・復元は引き続き未検証。


公開直前に別担当の8fa05e58ffd4531520b6e6d5af7fd3b5d3afc388が追加されたため、同コミットをfast-forwardで取り込んで再検証した。別担当のニュース修正6ファイルはそのまま保持し、今回の差分には含めない。統合後の最終結果はNode 749/749、Python 2,404/2,404（125.556秒、RESEARCH_TEST_NOW=2026-10-08T06:00:30+00:00）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、差分チェック成功。


## 2026-10-12 — 診断の英語説明と締めのコピー修正

ユーザー承認のClaude案を反映。許容できる下落が未設定の説明を「Choose how much of a drop would feel painful, and the amount will appear here.」へ差し替えた。結果画面のアドバイスの下、免責と保存操作の前に、日英それぞれ2行の締めを追加。日本語は「マイルールを定めれば / 暴落も上昇も怖くない」、英語は「With rules of your own, / crashes and rallies lose their grip.」。計算・権限・保存APIの動作変更はない。


## 2026-10-12 — RESOLUTE ②③④と通知時刻の接続

最新版ZIP（SHA-256: a283e2798f2913d6ce9e7b93c5aba534550dbb59dc9a229f0b87f347298d7e8b）の4画面を参考に、②の保存計画読込と保有額0、③アラート、④初期オフの翌朝、日英共通メニューを追加。③④は7/8/9/10時（日本時間、初期7）の共通設定をrevision付きAPIで保存する実装。添付alert-judge.tsは変更せず、未確定終値は通知状態を進めない。本人の利用権＋通知利用権、指定時刻、宛先確認と配信停止を検査し、重複を防ぐoutboxと翌朝の判定を追加した。

仕様・API入出力・UTC cron・DB/変数名・未接続事項は `docs/RESOLUTE-NOTIFICATIONS.md`。実DBへの002〜005適用、通知writer作成、Cron、価格・メール提供元、署名付き配信停止、独立削除履歴と実復元は未完了。通知設定APIの本番ゲートは無効のまま、計画API503も維持。本番保存・配信完了とは扱わない。実メール、既存ニュース、他DB、Railwayサービス・変数・プラン・費用設定は変更していない。④メール下書きの「昨夜」は朝配信と合わないため「昨日」への文言確認を残す。


検証結果：Node 781/781、Python 2,406/2,406（131.439秒、RESEARCH_TEST_NOW=2026-10-08T06:00:30+00:00）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。添付のalert-judge/mail-templatesもテストへ組み込み、元ファイルとの一致を確認。隔離PostgreSQLで通知設定の保存・再読込・別人拒否・更新競合・限定writerの権限、outboxの重複時に未送信ラインを既通知にしないこと、確定前の除外、受付確認済み③だけを起点にする④を確認。送信直前の権限・時刻・設定変更・配信停止・宛先確認も純粋なテストで確認した。

Chromiumの390px幅で日英の③→④→②→③を操作し、9時設定の保存/読戻し、④初期オフとオン保存、②保有額0と保存計画の初期値、横はみ出しなし、409で上書きしないことを確認。ブラウザ側のAPI応答はテスト用に差し替えた。実Clerk/Railway/本番DBの保存や実メール到達を確認した結果ではない。基準ブランチは別担当更新を含むe7666dc。


## 2026-10-12 — ④翌朝メールの文言変更（承認済み）

ユーザー承認により、④の件名・本文にある「昨夜」をすべて「昨日」へ、"last night's alert"をすべて"yesterday's alert"へ変更した。日本語3か所・英語2か所。共通テンプレートを使う画面のメール例にも反映される。以前の文言確認待ちは解消。配信条件・時刻は変更せず、本番メール配信は引き続き未稼働。実メールは送信していない。


## 2026-10-12 — RESOLUTE 最終参考画面①〜⑥の統合

最新版resolute-logic(2).zip（SHA-256: 90fe0a508ef76fc01cbce099b4e2781bca71d0f405f435280cdff2283be09c1e）のREADME、6つのpreview-ref HTML、EN-UI-texts.mdを確認。①〜⑥をRESOLUTE内の共通メニューで接続し、⑤ `/resolute/thermometer` と⑥ `/resolute/tax` を追加。HTMLの確認用バナー・状態切替・Claudeへの外部ページリンクは製品に組み込まない。英語は添付案を基に自然な表現へ調整した。①の診断ロジックには既存の計算共通化・検証済み修正があるため、ZIPで上書きしていない。既承認の「昨日／yesterday's alert」も維持。

②の上昇画面は最新参考HTMLに合わせ、3銘柄が同じ率で上昇した場合の総額・銘柄別割合・上限の線を表示する。銘柄名は画面内だけで扱い、保有額はすべて0から。保存済み計画の生活費・許容額・上限割合・買い増しラインを初期値とする。③④の設定・revision・時刻・未確定終値の扱いは維持。

⑤は画面のみ。メーター、4区分の説明、セクター一覧、判断方法の欄を用意する。実際のスコア・針・現在位置・更新日時は出さず準備中とする。4区分を押す操作は説明の閲覧であり、相場の状態を変更するテスト操作ではない。計算式・しきい値・価格提供元・実更新はデータ契約後に確定する。セクターの通知利用権表示は参考デザインで、データ取得や権限別の実データ提供は今回未実装。

⑥は添付jp-tax.tsを組み込み、売却・損切り、源泉徴収あり／なし／NISAの入力と結果を日英で表示。2026年分に固定し、両言語とも円の整数（0〜1兆円）で入力する。小数・負数・上限超過は計算結果を出さない。外貨を自動換算しない。自由入力・銘柄名・税務金額をDB、ブラウザ保存領域、メール、ログへ保存・送信しない。免責は「入力した条件に基づく概算であり、税務相談ではありません。」／"An estimate based on what you entered. Not tax advice."へ統一。

税額の基本式と繰越条件は国税庁No.1463・1474（令和8年4月1日現在法令等の掲載本文）を参照した。税制改正の網羅確認や個別事例の税務確認を完了した扱いにはしない。各税目の1円未満切捨てによる概算であり、申告の端数処理とは異なる。画面では前年繰越損失・配当等・外国税額控除・為替換算を対象外と明記。英語注記のother incomeは相殺対象を広げないようeligible gainsへ修正。

参考一次情報: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1463.htm / https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1474.htm

購入権限は⑤⑥も既存ToolShellのuse.activeで確認する。PROだけでは使えない。計画・通知設定APIの本番ゲート、DB移行・独立削除履歴・復元、メール・価格提供元・Cronは従前どおり未稼働／未確認。今回インフラ・費用・既存ニュース・他DB・mainは変更せず、実メールも送信していない。

検証結果：Node 805/805（添付税計算21件と円入力の境界確認を含む）、Python 2,408/2,408（138.884秒、RESEARCH_TEST_NOW=2026-10-08T06:00:30+00:00）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。Chromiumで日英の6画面を320/390/1280px幅で確認し、横はみ出しなし、共通メニュー、通知設定の共有・409、保有額0、税金の売却／損切り／NISA／不正入力拒否、温度計の説明選択と架空データなし、未購入で税計算入力を表示しないことを確認した。ブラウザの利用権・計画・設定APIはテスト用に差し替えており、本番の計画保存やメール到達を検証した結果ではない。別担当のd7371afを取り込んで検証した。


## 2026-10-12 — RIZEL専用の購入前確認入口

購入権限がないため運営者も全画面を確認できなかった問題に対応し、Preview環境限定の `/resolute/review` を追加。`GET /api/resolute/review-access` は検証済みClerkセッションのuserIdを既存の唯一の運営者IDと照合する。PRO・adminロール・URLパラメータ・購入権限の偽装では通さない。productionでは運営者もこの確認入口を許可しない。通常の利用権API、購入必須条件、通知利用権の判定は変更しない。

専用入口では①〜⑥の実際の画面部品を使い、画面内だけのサンプル計画・通知設定で操作できる。最初からサンプル計画を用意し、①の診断・結果・一時保存から②へ移動できる。③④の設定も同じ画面内で共有する。保存ボタンの操作はブラウザのメモリだけに反映し、DB・localStorage・sessionStorageには記録せず、メールは送らない。画面上部にサンプル・一時保存・再読み込みで消える旨を明示する。通常の計画・通知APIには一切リクエストしない。ログインセッション変更で画面を破棄し、60秒ごととフォーカス時に運営者判定を再確認、失敗時は画面内データごと閉じる。日本語・英語の切替は6画面で共通。

認証前には専用入口内でClerkのログインを表示し、ログイン後はこの入口へ戻す。未購入の一般アカウントを許可する設定や購入履歴は作成していない。金額・プラン・Railway・本番メール配信は変更していない。通常の計画保存・通知設定APIの稼働が完了した扱いにはしない。

検証: Node 808/808、Python 2409/2409（146.163秒）、lint 0 errors、Next.js build、compileall、git diff --check成功。ローカルChromiumで運営者判定APIだけをテスト用に差し替え、①の結果表示・一時保存→②試算、③設定→④への共有、⑤説明、⑥税額計算、言語維持、再読み込みでの初期化、認証失敗時の画面破棄を確認。計画・通知APIへの通信は0件。運営者本人の実ログインを使用した確認とは区別する。税計算テストのSetに型を付け、TypeScript検査エラーも修正した。別担当のce50500を取り込んだ統合ツリーで再確認。


## 2026-10-13 JST — 診断開始画面と運営者確認の画面移動を修正

オーナーから、Claudeの開始画面との相違、上部6項目、30問が見つからない、スマホ見出しの改行・数字のずれ、②への移動時にログインが外れたようになるとの報告を受けた。前回の確認用サンプル計画は初回状態から除去し、`{plan:null, revision:0}`で始める。「はじめる」から未回答の質問を1問ずつ進め、結果・画面内保存・②へ進む流れに戻した。共通メニューは開閉式に変更し、6項目を常時表示しない。Claudeの開始文・中央配置・600px幅・配色・結果の見出しとアドバイス表示に合わせた。見出しは「投資ルールを、」で改行し、Noto Serif JP／Noto Sans JPをライセンス付きのローカルWOFF2として組み込む。Google Fontsへの表示時通信やビルド時の多数の字体ダウンロードは不要。フォントは既存のRESOLUTE文字集合のサブセットで、他の文字は日本語システムフォントへフォールバックする。

運営者用の画面移動はリンク・hash・Nextルーターによる移動から、同じ画面内のボタン操作へ変更した。既存の確認URLのフラグメントは画面切替に使用しない。Clerkのログイン用hashルーターと混在させない。運営者確認はClerkのgetToken({skipCache:true})でセッショントークンを更新してから、同一オリジンの確認APIへBearerで渡す。トークンはログ・保存領域へ出さない。通信失敗・429・5xxはログイン解除と同一視せず、入力をメモリに保持したまま画面を隠して再確認を表示する。明示的な401／403やClerkセッション変更は引き続き画面内データを破棄する。診断は他ツールへ移動中も隠して保持するため、未完了の30問へ戻れる。

購入権限・通知利用権・本人限定のサーバー検証は緩めていない。確認操作の保存先は画面内メモリのみ。本保存・通知API・メール配信の完成を意味しない。ニュース・他DB・請求／プラン・mainは変更していない。オーナーのiPhoneで起きた事象自体の原因を完全に再現した扱いにはせず、確認できた脆い経路を修正する。

検証：ローカルChromiumのモバイル・タップ操作（320px／390px）で未回答開始、30問すべての回答・結果・一時保存→②試算、メニュー往復、言語切替、通信503からの回答復旧、403時のデータ破棄、見出し2行・横はみ出しなしを確認。認証APIはこのローカル試験では差し替えている。セッショントークン更新が確認APIより先に実行されることは別途単体試験済み。WebKitは実行環境の依存ライブラリを用意できず未実行で、実機Safari確認済みとは書かない。別担当の21b7276を統合し、リポジトリ指定の検証を実施する。

## 2026-10-13 JST — Claude最終版に合わせた6画面の再調整

- 基準は添付 `resolute-logic(2).zip` のREADMEと `lib/preview-ref/` の6つのHTML。見出し、紺と金の配色、ライン別の金・橙・赤、明朝の数字、カード、スライダー、スイッチ、折りたたみ欄を再照合した。プレビュー専用の状態切替と例の市場数値は製品に移さない。
- 診断30問は日本語本文を変更せず句の区切りを明示。英語開始見出しは `Build your own investing` / `rules in 30 questions.` の2行。タッチ端末にはホバーの黄色枠を適用せず、選択状態とキーボードのフォーカスは維持する。
- 数字欄は入力中も3桁カンマ表示、編集位置を保持。ゼロはフォーカス時に空欄として入力できる。呼び出し元にはカンマなしの数値文字列を渡す。入力フォーカスは1本の枠に統一。
- シミュレーションの説明はオーナー指定の全文に変更。JPY金額はClaude版どおり万円入力、USDはドル入力。表示単位から最小単位への換算は十進文字列で行い、端数の丸め誤差を避ける。税金画面は万円入力、手数料のみ円。計算ロジック・年度・税率は変更しない。
- ②→③→④→⑤→⑥→①の導線を各画面末尾に追加。④の時刻変更は時刻と同じ行で、その場で4択を開く。運営者確認では③④の下書きを共有し、画面の行き来で銘柄等の未保存入力を消さない。診断を保存し直した際は計画だけ再読込する。
- ⑤は目盛り・針の外観を戻し、未接続の現在値は `—` / 準備中として表示。薄い針は外観用で実測値ではない。市場判断やしきい値の未確定状態は変わらない。
- 通知の有効化・停止には保存が必要。メール配信準備中の表示は残し、UI確認でメールを送らない。購入・通知利用権・オーナー確認の認証条件は変更しない。
- 確認範囲はChromiumの320/390pxタッチ設定と600px画面。iPhone Safariの実機確認は未実施。実データ・本番通知の完成を意味しない。

## 2026-10-13 JST — オーナー再確認後の入力と往復導線

- ①開始文は指定どおり「あなただけの投資ルールを / 30問の質問でつくる。」「答えるほどルールは鮮明になります。」「※所要時間 約5分」。開始・次問は質問見出しへスクロールし、質問中の戻る／次へは画面下に追従。通貨・保存の説明は開始画面に移動した。
- ②の下落試算は①の投資済み金額（investedAmount）を初期値にする。現金を含むfinancialAssetsを株式保有額として使わない。未回答は0。銘柄別の上昇試算に総額を任意配分しない。
- ③は未登録時にも銘柄・基準価格の空欄を表示。会社名は既存のTech Phase銘柄検索APIで候補を出し、本人の選択でティッカーへ置換。推測で銘柄を確定しない。検索不可／該当なしを表示。タップで全選択、クリアボタン、IME入力に対応。検索語・試算値の新しい保存領域は追加しない。参照先のニュース・銘柄API自体は変更しない。
- アラートメールは「あなたの計画では」を冒頭へ移し、画面のメール例で金色強調。冗長な選択の説明を、保存計画の買い増し額・買わない条件・1銘柄上限を確認する文へ変更。売買推奨・相場予測を追加していない。実メールは送信していない。
- ④の初期オフの重複説明と「正解・不正解」を削除。指定の改行と文言へ変更。「計画を開く」はモーダルで保存済みルールを表示し、閉じると同じ④・選択状態へ戻る。自由記述だけでなく選択式の条件も表示する。
- ⑥の外部リンクを画面から除去。計算前提・年度・免責と内部資料の出典は維持。税率・税計算は変更しない。各カードの細い金縁、見出し・入力ラベル・結果の金色を統一。
- オーナー確認の保存は引き続きメモリ内。実DB保存・配信・⑤のデータ提供を完了扱いにしない。

## 2026-10-13 — 通貨選択とマイルールの最終調整

オーナー承認に基づき、表示言語とは独立したJPY/USD選択を①の開始画面に追加。JPYは円の整数、USDはドル表示・小数2桁まで入力し、保存前に十進文字列から整数セントへ変換する。上限は既存どおり10^12最小単位。USDの生活費は円建ての範囲を流用せず「入力する」のみとする。未保存の回答がある場合、通貨変更は回答の初期化を確認してから行う。保存済み計画の通貨は維持し、金額の自動換算・通貨の付け替えは行わない。診断のタイプ判定は変更せず、金額を含む日英の結果・アドバイスだけ保存通貨に合わせて表示する。q30は引き続きUSD/JPYの値動き幅（円）であり、③の基準株価はUSD、⑥の日本の税金計算はJPYのまま。

⑥の次の導線を「マイルールを仕上げる」に変更し、`/resolute/notebook` を追加。診断の保存済み開始画面とRESOLUTE専用メニューからも開ける。濃紺・金の装丁、保存日、7つのルール、通知設定の読取表示で一冊のノートとしてまとめる。買い増しラインは質問回答から再生成せず、保存済み計画の実際のラインと金額を表示する。小さな「最終調整」から準備月数・1銘柄上限・自由記述の条件を編集し、再計算した金額を確認してPUT保存する。対応するq05/q22は変更したときだけcustomへ更新する。既存の選択式条件、買い増しラインと金額、通知設定は維持する。409や保存成否不明時に自動再送せず、入力を残して読込確認を要求する。

通知欄の小さな「変更」は既存の③または④へ移動する。ノートを読む・調整する・端末保存する処理は通知設定PUTを呼ばない。運営者専用入口のノート移動も同じ画面内で行い、Clerkのhashルーターと混在させない。通常画面は既存のuse.active判定を使用し、購入必須・PRO非代替・通知利用権の条件は変更していない。

「このノートを端末に保存」は本人のクリックで、保存確認済み計画のHTMLの写しをダウンロードする。外部通信・JavaScript・外部フォントを含まず、自由記述はHTMLエスケープし、CSPで外部読込等を禁止する。言語は保存時の表示言語、金額は保存通貨。後日の編集はダウンロード済みファイルへ自動反映しない。ファイルには資産情報が含まれる旨を表示する。PDF自動生成、外部クラウド保存、自動同期は追加していない。

制限：運営者確認の計画と通知設定は引き続きタブ内メモリのみで、再読み込みで消える。本番の計画API・通知APIの稼働、DB永続保存、実メール送信、⑤の価格データ接続を今回完了した扱いにしない。端末へのHTML保存はこの一時保存とは別に残せる。新しい外部サービス・追加費用・他DB・ニュース・請求／プラン・mainの変更はない。

検証：Node 827/827、Python 2411/2411、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。ローカルChromiumの320/390/600pxで①から⑥・ノートへの移動、USD小数入力と②への引継ぎ、ノートの調整保存、自由条件の表示、HTMLダウンロード、日英切替、横はみ出しなしを確認。所有者確認APIのみテスト用に差し替えた試験であり、実DBへの保存・実メール送信の検証ではない。Safari実機の確認は未実施。

## 2026-10-14 JST — ページをめくる個人版ルールブック

オーナーの再指示により、①の通貨選択はJPY/USDボタンを残して見出し・自動換算の説明・⑥税金の注記を開始画面から除去し、余白を圧縮した。通貨処理と⑥のJPY固定という実仕様は変更していない。

マイルールは縦長一覧から、濃紺の装丁・金箔風文字・紙色の本文・ページ端・しおりを持つ本へ変更。左右のスワイプ、矢印ボタン、キーボード左右でページをめくり、prefers-reduced-motion時は回転を止める。表紙の後に自分の傾向、情報への反応、守るお金、下落時の見直し、損切り、買い増し、買わない／止まる条件、上昇時の行動、迷ったときの確認を章立てする。買い増しラインは1ページ最大3段階、自由条件も最大3件ずつに分け、省略せず読む。質問の全回答を一覧に転載せず、既存Claude診断のタイプと回答済み選択肢・保存金額・条件から決定的な文を組み立てる。外部生成AIへの送信・新しい費用はない。為替章は本と保存ファイルから除去し、診断・計画データのfx自体は維持。

損切りラインは許容下落から推定せず、PlanInputに後方互換の任意キー `stopLossPct?: number | null` を追加した。旧計画のキー欠落とnullは未設定。本人が「ルールを整える」で入力した0.1〜99.9、小数1桁までを保存する。負数・0・100以上・非数・型不一致をクライアント／サーバーで拒否。基準は既存investBase（投資済み額>0ならその額、それ以外はinvestable）。基準不明／0なら金額を作らない。損失額は `floor(investBase × stopLossPct / 100)`、評価額は基準額から損失額を引く。整数演算を使用しJPYは円、USDはセント。個別銘柄の取得価格からの騰落率や発注価格ではないことを画面内に明示する。元のtolerancePct/toleranceDropは独立した見直し基準のまま変更しない。診断を再編集・再保存しても本人設定のstopLossPctを保持し、削除操作では計画とともに消える。注文・自動売却・新しい損切りメールは追加しない。

ノートの調整・閲覧・ダウンロードで通知設定を書き換えない。「いつものお知らせ」に折りたたみ、小さな変更ボタンから③④へ移動。端末保存は同じ章立てのHTMLの写しに変更し、外部通信とJavaScriptを使わずページ内リンクとCSSでめくる。印刷時は全ページを順に表示。自由記述はHTMLエスケープし、CSP・保存時点の写し・私的保存の案内を維持。本番API/DB永続保存・実メール・温度計データが稼働済みになったことは意味しない。stopLossPctを受け付けるAPI側コードも今回の改訂版が必要であり、本番ゲートを開ける前にVercelとRailwayの対応版を揃えること。

検証：別担当の95b5b29を統合したツリーでNode 830/830、Python 2411/2411（141.748秒）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。Chromiumの320/390/600pxで日英の章送り・逆送り・終端・損切り設定保存・円/USDの金額・HTML保存とオフラインのページリンク・横はみ出しなしを確認。最終の320px試験では実タッチイベントによるスワイプ、前ページへ戻る操作、めくるボタンが画面内に収まることも確認した。本人認証APIのみローカル試験用に差し替えており、実DB保存やメール到達の合格ではない。Safari実機は未確認。
