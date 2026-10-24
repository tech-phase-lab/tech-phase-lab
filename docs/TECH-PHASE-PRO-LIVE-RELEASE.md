# Tech Phase PRO 本番切替手順

2026-10-25 JST。実装基準: baac718cb651638e3a5bbf074a8936dd2517f395。
実装commitのGitHub Actionsは全ジョブ成功。
[検証結果](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40105472690):
lint・Node全体・Python全体・Next build、および別ジョブのSandbox PostgreSQL並行処理/保存復旧。
Liveの実サービスに接続した証明ではない。

この文書は準備用。Railway接続・再認証禁止を解除せず、現時点で下記の設定変更、DB適用、実決済、定期実行を行わない。
本番での接続確認と受入が済むまでは販売開始済みと扱わない。

## 配置するもの

Web側は既存Next.jsアプリ。決済APIは `services/tech-phase-billing` のDockerfileで作る専用サービス。
同じイメージを使う定期照合の入口は `node live-recovery-entry.mjs`。
SandboxやRESOLUTEのサービス・DB・プランを上書きしない。mainへの変更はこの手順に含めない。

## 設定の配置先

秘密値は環境設定だけに保存し、文書・リポジトリ・画面・ログに貼り付けない。
以下の省略なしの変数名は現在のコードに対応する。

| 変数 | Web側 | 決済API側 | 定期照合側 |
| --- | --- | --- | --- |
| `TECH_PHASE_PAYPAL_ENV` | `live` | `live` | `live` |
| `TECH_PHASE_BILLING_LIVE_ORIGIN` | 本番独自ドメインのHTTPS origin | 同じ値 | 同じ値 |
| `TECH_PHASE_BILLING_LIVE_ENABLED` | 初期 `false` | 初期 `false` | 不要 |
| `TECH_PHASE_BILLING_LIVE_SALES_ENABLED` | 初期 `false` | 初期 `false` | 不要 |
| `TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED` | 初期 `false` | 初期 `false` | 不要 |
| `TECH_PHASE_BILLING_LIVE_SERVICE_URL` | 専用APIのHTTPS origin | 不要 | 不要 |
| `TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN` | 専用トークン | 同じ値 | 不要 |
| `TECH_PHASE_BILLING_RUNTIME` | 不要 | `railway-live` | `railway-live` |
| `TECH_PHASE_BILLING_LIVE_BRANCH` | 不要 | 配備対象の承認済みブランチ名 | 同じ値 |
| `TECH_PHASE_BILLING_LIVE_DATABASE_URL` | 不要 | 専用writerの接続先 | 同じ値 |
| `TECH_PHASE_PAYPAL_LIVE_CLIENT_ID` | 不要 | Live専用 | 同じ値 |
| `TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET` | 不要 | Live専用 | 同じ値 |
| `TECH_PHASE_PAYPAL_LIVE_WEBHOOK_ID` | 不要 | Live専用 | 同じ値 |
| `TECH_PHASE_PAYPAL_LIVE_PLAN_JPY` | 不要 | 月額2,980円のプランID | 同じ値 |
| `TECH_PHASE_PAYPAL_LIVE_PLAN_USD` | 不要 | 月額$20のプランID | 同じ値 |
| `TECH_PHASE_BILLING_LIVE_WEBHOOK_ENABLED` | 不要 | 初期 `false` | 不要 |
| `TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED` | 不要 | 不要 | 初期 `false` |
| `TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT` | 不要 | 不要 | 初期 `10`、最大 `25` |

Web側はホストが設定する `VERCEL_ENV=production` が必須。previewに本番資格情報を置いたり、この値を偽装したりしない。
決済APIと定期照合では、ホストが設定する `RAILWAY_GIT_BRANCH` と `TECH_PHASE_BILLING_LIVE_BRANCH` の完全一致が必要。
`TECH_PHASE_BILLING_LIVE_ORIGIN` は末尾スラッシュなし。パス、クエリ、ポート、vercel.appは受け付けない。
`TECH_PHASE_BILLING_LIVE_SERVICE_URL` は専用の `https://…up.railway.app` origin。Sandboxと別のURL。
サービス用トークンは43〜128文字の英数字・`_`・`-`だけで構成する秘密値。

## DBとPayPalの準備

1. DB名 `tech_phase_billing_live`、ログイン名 `tech_phase_billing_live_writer` を用意する。
   writerに所有者権限、管理者権限、他の強いロールの継承を与えない。移行は別の管理用接続で行う。
2. 対象DBを確認して `db/tech-phase/005_billing_live.sql`、`006_live_recovery.sql` の順で適用する。
   005は001〜004のLive版を含む。Sandboxの001〜004やSandboxの会員・支払行を本番へコピーしない。
3. アプリの接続URLは上記DB/ログイン名とパスワードを含める。TLS証明書・ホスト名検証を必須とする。
   URLのクエリを付ける場合は `sslmode=verify-full` のみ。内部ホストでもLiveはTLS検証を省略しない。
   writerで必要なSELECT/INSERT/UPDATEが可能で、DELETE・DDL・他スキーマ操作が不可能なことを確認する。
4. PayPal LiveのJPY/USDプランを別IDで用意する。毎月1回・無期限・通常料金のみ。
   試用、初期費用、追加税、段階料金は使わず、未払残高の自動請求は無効にする。
   実装は購入前にプラン内容も照合する。ID形式の検査だけでは実設定の証明にならない。
5. Live通知先は専用APIの `/webhooks/paypal/live`。Web側のAPIやSandbox通知先を指定しない。
   対象は `PAYMENT.SALE.COMPLETED`、`PAYMENT.SALE.REFUNDED`、`PAYMENT.SALE.REVERSED`、
   `BILLING.SUBSCRIPTION.*` のライフサイクル通知、および
   `CUSTOMER.DISPUTE.CREATED` / `UPDATED` / `RESOLVED`。
   ワイルドカード表記は分類を示す。PayPal側では該当する実イベントを選択し、Live webhook IDを設定する。

## 有効化と受入の順序

1. 販売・権限・通知・定期照合を無効にした状態で配置する。
   `/healthz` の200はプロセス起動だけを示す。DB/PayPalへの接続成功を示さない。
2. Web/APIの `LIVE_ENABLED` を有効にし、新規受付は無効のままにする。
   本番ログイン済み会員で `/api/research/billing/live/readiness` を確認する。
   `configurationReady` はAPI側の設定形式の検査だけ。`connectionVerified` は常にfalse。
   statusの読み取りでDB接続を確認し、PayPal側の実プラン/通知設定も別途照合する。
3. API側の `LIVE_WEBHOOK_ENABLED` を有効にし、署名検証と台帳記録を確認する。
   一般公開されている通知入口に会員Cookieやサービス用Bearerトークンは不要。PayPal署名は必須。
4. 既存本番会員への影響を確認してからWeb/APIの `LIVE_ENTITLEMENTS_ENABLED` を有効にする。
   有効化後はLive台帳が権限の根拠となり、古いClerk metadataはPRO権限の代替にならない。
   Sandboxで購入済みでもLiveの支払証明にはならない。既存会員を無根拠にPROへ移さない。
5. 承認済みの実決済受入時だけWeb/APIの `LIVE_SALES_ENABLED` を有効にする。
   現在のLive購入にはテスト会員だけを許す制限がないため、有効化は全認証済み会員への受付開始になる。
   全体の受付開始を認められない時点ではこのフラグを有効化しない。
6. 下表の実証拠を揃える。失敗時は新規受付を停止し、未確認を合格にしない。
7. 定期照合はDB移行と接続確認後にだけ有効化する。同じイメージ/設定で単発実行を確認した後、
   実行件数と遅延に合わせてスケジュールを設定する。再照合だけで、新しい請求や解約は作らない。
   初期10件・最大25件、開始から3分で次の契約を開始しない。leaseは5分、契約間隔500ms。
   全会員の一括処理ではないため、実契約数と処理速度に対して実行頻度が足りることも確認する。

上記手順の `LIVE_*` は、表にある `TECH_PHASE_BILLING_LIVE_*` の省略表記。

| 実受入 | 保存する証拠（秘密値・個人情報は除外） |
| --- | --- |
| JPY/USD購入 | 通貨/金額、承認後の確認済み支払期間、PRO表示、確認時刻 |
| 会員分離 | 別会員の契約操作拒否、一方の変更が他方の権限に影響しない結果 |
| 更新と重複 | 更新支払の期間反映、同じ通知を再送しても重複記録しない結果 |
| 解約と期限切れ | 解約後の支払済み期限維持と、期限経過後のFREE表示 |
| 返金・異議 | 権限保留、遅延した支払通知や定期照合で自動復帰しない結果 |
| 障害と回復 | DB/API障害時にPROを誤付与しない結果、中断後のlease回復と照合件数 |
| 定期運用 | 集計ログのchecked/failed/leaseLost、処理遅延、次回実行、バックアップの確認記録 |

返金/異議を本番で作って検証する操作は、この文書だけでは実行しない。
実取引の扱いを承認した範囲で証拠を集める。自動テスト成功を実受入の代わりにしない。

## 受付停止と復旧

新規購入だけを止める時はWeb/APIの `TECH_PHASE_BILLING_LIVE_SALES_ENABLED=false`。
`LIVE_ENABLED`、`LIVE_ENTITLEMENTS_ENABLED`、通知経路、定期照合は維持し、既存会員の解約・支払確認を続ける。
定期照合だけに問題がある場合は `LIVE_RECOVERY_ENABLED=false` にして調査する。

`LIVE_ENTITLEMENTS_ENABLED=false` は通常の受付停止には使わない。
現在のコードはこのフラグが無効だと以前のmetadata判定に戻るため、古い権限が再び参照される可能性がある。
また `LIVE_ENABLED=false` は会員の解約・照合APIも止める。全停止が必要な障害時は影響を判断して対応する。
返金・異議のholdや台帳行を削除して復旧させない。未知の支払を推測して権限付与しない。
