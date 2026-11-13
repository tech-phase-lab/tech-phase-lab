# RESOLUTE 終値アラート／翌朝のひとこと — 配信開始の手順書（2026-11-13）

コードは `main` 相当（codex/research-preview）に入っている。本番変更（変数・ロール・サービス・フラグ・メール送信）は、各回オーナーの承認が要る。値（鍵・パスワード・接続文字列）は、書かない・見ない・出力しない。

## A. 足りないもの（mail-preflight と実装の突き合わせ）
| # | 不足 | コードで解決 | 本番で必要な作業 |
|---|---|---|---|
| 1 | 送信ロール `resolute_notification_sender` は 020 で NOLOGIN のまま。ログイン化するジョブが無かった | 追加: `scripts/resolute/enable-mail-sender-login.mjs`（この PR） | ジョブ実行（パスワードは環境変数） |
| 2 | 候補作成ロール `resolute_notification_queue` | #452 で追加済み | ジョブ実行 |
| 3 | メール送信元ドメインの認証、資格情報の有効性 | #455 `mail-domain-check.mjs` | 実行（Resend の鍵が必要。送信専用キーだと `key-restricted`。その場合は Resend の画面で Domains が Verified かをオーナーが目視） |
| 4 | Resend の配信結果 Webhook | 実装済み（resolute-api の `/webhooks/resend`、署名検証、無効時503） | resolute-api の公開URLを Resend の Webhooks に登録し、署名の秘密を `RESOLUTE_RESEND_WEBHOOK_SECRET` に設定 |
| 5 | 配信停止の公開ルート | 実装済み（Vercel `/resolute/unsubscribe` → resolute-api） | `RESOLUTE_MAIL_STOP_PUBLIC_ENABLED=true`（Vercel）等と、本番での到達確認（B-6） |
| 6 | Cron の失敗監視 | #454 で「無効=0、失敗=非0」 | Railway の失敗通知が有効か確認 |
| 7 | テスト用の安全弁（オーナーだけに作る） | 追加: `RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS`（この PR） | テスト中だけ設定、会員開始の直前に外す |
| 8 | 米国休場日カレンダーは 2026〜2027 のみ | 範囲外は「何も送らない」で安全 | 2027年12月までに延長 |
| 9 | 実際のメール到達（日英の受信箱）、DB権限・マイグレーションの本番確認、復元の棚卸し | 不可 | B の手順で確認 |

## B. 順番つきの手順（上から順に。各ステップの前に、オーナー確認）
1. **読み取りのみの現状確認**（コンソール）:
   - `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'resolute_notification_%';`（writer/sender/queue の有無）
   - `SELECT to_regclass('resolute.notification_outbox'), to_regclass('resolute.notification_state'), to_regclass('resolute.notification_suppressions');`（017〜018、005 の適用）
   - 020 未適用なら先に適用（既存のファイルをそのまま）
2. **ロール**: 1) `provision-notification-queue.mjs`（`RESOLUTE_PROVISION_NOTIFICATION_QUEUE=true`, `RESOLUTE_SETUP_DB_URL`, `RESOLUTE_NOTIFICATION_QUEUE_PASSWORD`）2) `enable-mail-sender-login.mjs`（`RESOLUTE_ENABLE_MAIL_SENDER_LOGIN=true`, `RESOLUTE_SETUP_DB_URL`, `RESOLUTE_NOTIFICATION_SENDER_PASSWORD`）。どちらも検証は ROLLBACK、成功時はイベント名だけ出力。
3. **変数（名前のみ）**:
   - cron サービス `resolute-notifications`: `RESOLUTE_NOTIFICATION_QUEUE_DB_URL`（queue ロール）, `RESOLUTE_NOTIFICATION_SENDER_DB_URL`（sender ロール）, `RESOLUTE_ENTITLEMENT_SOURCE=live`, `TWELVE_DATA_API_KEY`, `RESOLUTE_MAIL_CLERK_SECRET_KEY`, `RESOLUTE_MAIL_PUBLIC_ORIGIN`(`https://techphase.app`), `RESOLUTE_RESEND_API_KEY`, `RESOLUTE_MAIL_FROM`, `RESOLUTE_MAIL_STOP_KEY_HEX`（保護鍵と別の値）, `RESOLUTE_MAIL_STOP_ENABLED`, `RESOLUTE_MAIL_FEEDBACK_ENABLED`, `RESOLUTE_MAIL_MONITOR_ENABLED`, `RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS`（オーナーの本人ID。テスト中のみ）。フラグ `RESOLUTE_NOTIFICATION_QUEUE_ENABLED` / `RESOLUTE_MAIL_DELIVERY_ENABLED` は、ここでは未設定のまま。
   - resolute-api: `RESOLUTE_NOTIFICATION_SENDER_DB_URL`, `RESOLUTE_MAIL_FEEDBACK_ENABLED`, `RESOLUTE_RESEND_WEBHOOK_SECRET`, `RESOLUTE_MAIL_FROM`（停止リンクの処理は既存の stop 変数・保護ゲートウェイ変数が前提）。
   - Vercel: `RESOLUTE_MAIL_STOP_PUBLIC_ENABLED`（B-6 の直前）。
4. **確認（読み取り）**: `node services/resolute-api/mail-preflight.mjs`（cron サービスで）が `configurationValid: true` か。`mail-domain-check.mjs` が全部 true か（または Resend 画面で Verified）。
5. **Webhook 登録**: Resend の Webhooks に、resolute-api の公開ドメイン + `/webhooks/resend`、イベントは sent / delivered / delivery_delayed / bounced / failed / complained / suppressed。公開ドメインが無ければ作成（オーナー承認）。
6. **配信停止の到達確認**: オーナー宛テストメールの停止リンクを開き、停止ページ→確定で、`notification_settings` の `alertsEnabled`/`morningEnabled` が false になり、再度の候補が作られないこと。
7. **オーナー宛テストメール1通**（下の C）。
8. 会員への配信開始（下の D）。**必ず親→オーナーの最終確認を挟む。**

## C. オーナー宛テストメール1通
1. 前提（保存APIは切のまま）: オーナー用ジョブ `scripts/resolute/owner-test-seed.mjs`（一時サービス `services/resolute-owner-test-seed`）で、オーナーのアカウントだけにテスト用の計画（買い増しライン-10%/-20%）と通知設定（アラートON・翌朝のひとことON）を入れる。モードは `RESOLUTE_OWNER_TEST_SEED=on`。値は環境変数: `RESOLUTE_OWNER_TEST_SYMBOL`、`RESOLUTE_OWNER_TEST_REFERENCE_PRICE`（直近の終値の約1.5倍など、確実に最初のラインを超える値）、`RESOLUTE_OWNER_TEST_HOUR`（7〜10）。DB・保護ゲートウェイの変数は 6b（acceptance）と同じ（`RESOLUTE_PLAN_DB_URL`、`RESOLUTE_NOTIFICATION_DB_URL`、`RESOLUTE_PROTECTION_*`）。オーナーに計画か設定の行が既にあれば、上書きせず中止する。ほかのアカウントには触れない（ID入力が無い）。また、メール送信にはオーナーのアカウントの受信設定（言語）が Clerk に保存済みであること。
2. cron の一時スケジュール: 届く時間（日本時間）の直前の分に、UTC で1回だけ（cron は UTC。例: 日本時間 8:00 の回に合わせて `55 22 * * *`）。または本スケジュール `0 0,1,22,23 * * *` のままでも、`ONLY_USER_IDS` により対象はオーナーのみ。
3. 乾燥運転: `RESOLUTE_NOTIFICATION_QUEUE_ENABLED=true` だけ（送信フラグは未設定）→ 実行 → outbox に **オーナーの1行だけ**（`SELECT clerk_user_id, kind, delivery_date_jst, accepted_at FROM resolute.notification_outbox;`）。メールは出ない。
4. 送信: `RESOLUTE_MAIL_DELIVERY_ENABLED=true` を足して次の回を実行。確認: `accepted_at` が入る／メール件名・本文／本文に「価格データ提供: Twelve Data」（日本語）または「Price data provided by Twelve Data」（英語）が入っている／停止リンクが https://techphase.app 上。
5. 翌朝: 「翌朝のひとこと」をオンにしていれば、翌日の同じ時刻に1通（事実だけの定型文）。
6. 戻し方: まず `RESOLUTE_OWNER_TEST_SEED=off` で同じジョブを実行（両方の通知OFF・監視銘柄を空に・テスト用計画を削除。停止イベントも保護ゲートウェイに記録）。次に、 `RESOLUTE_MAIL_DELIVERY_ENABLED` と `RESOLUTE_NOTIFICATION_QUEUE_ENABLED` を削除（または false）→ スケジュールを元に戻す／cron を停止。cron は「無効＝終了コード0」なので、フラグ未設定のままでも Crashed にならない。

## D. 会員への配信を始める直前チェックリスト（オーナー確認用）
- **前提: 保存API（`RESOLUTE_PLAN_API_ENABLED` / `RESOLUTE_NOTIFICATION_API_ENABLED`）の有効化。プライバシーポリシー確定後（オーナー決定）。** 会員が自分で通知設定を保存して初めて対象になる。保存APIが切のあいだは、会員は誰も対象にならない（C のテストはオーナー用ジョブで行う）。
- 対象人数（読み取り）: `SELECT settings->>'deliveryHourJst' AS hour, count(*) FILTER (WHERE settings->>'alertsEnabled'='true') AS alerts_on, count(*) FILTER (WHERE settings->>'morningEnabled'='true') AS morning_on FROM resolute.notification_settings GROUP BY 1 ORDER BY 1;`（実際に届くのは、さらに「確認済みメール・購入済み・アラート利用権あり」の人だけ）
- 既存の停止・失敗: `SELECT count(*) FROM resolute.notification_suppressions;` / outbox の `payload->'resendFailure'` の件数。
- 1通の内容サンプル: `/resolute/notification-preview`（オーナー専用）で日英を目視。
- 停止リンクの動作: テストメールで実施済み（B-6）。
- 件数の上限: 1回の実行で最大200人（超えると `incomplete` で終了コード1）。人数が多い場合は分割を検討。
- 外す: `RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS`。外した瞬間から、次の指定時刻の回で、有効にしている全会員が対象になる。
- 戻し方: 上記フラグを削除すれば停止。すでに受付済みのメールは取り消せない。
