# RESOLUTE 終値アラート／翌朝のひとこと — 配信の部品（2026-11-12、すべて無効のまま）

本番の設定・サービス作成・メール送信は一切していない。下の「オーナー承認が必要なもの」を承認するまで、何も動かない。

## 追加したもの
- `lib/resolute/notification-closes.ts` 終値の取得（Twelve Data 日足）。市場日は米国カレンダー（2026〜2027）で決め、終了30分後から確定扱い。範囲外・取得失敗は「終値なし」で、通知状態は進まない。メールに「価格データ提供: Twelve Data」を付ける。
- `lib/resolute/notification-queue-runner.ts` / `services/resolute-api/notification-queue.mjs` 指定時刻（日本時間）の対象者に、既存の `createNotificationOutboxJob` を実行（outboxに入れるだけ。メールは送らない）。既定は無効。
- `lib/resolute/morning-note.ts` 翌朝のひとこと。直前に受け付けられたお知らせの事実（銘柄・終値・率）だけから作る定型文。AIは未接続（費用ゼロ）。将来 `generateNote` を渡す場合は、厳密JSON・事実にない数字/銘柄/URL/助言表現の拒否・失敗時は定型文に戻る。
- `services/resolute-notifications/`（Dockerfile, run.mjs）Railway cron 用。①候補作成→②送信（既存 mail-worker）。フラグ未設定なら両方 `{"enabled":false}` で終了。
- 画面: 保存が未有効（503）の間は「準備中です」と表示し、60秒ごとに静かに再確認。有効になれば自動で本物の画面になる。
- オーナー用 `/resolute/notification-preview`: 実際と同じ関数で、メールの見た目を表示（送信なし）。

## オーナー承認が必要なもの（本番変更。まとめて1回で確認する）
1. Railway: cron サービス `resolute-notifications` の作成（このリポジトリの Dockerfile、スケジュール UTC `0 0,1,22,23 * * *`）。
2. DB: ログインロール `resolute_notification_queue` の作成と最小権限（USAGE、plans/notification_settings/entitlement_periods の SELECT、notification_state の SELECT/INSERT/UPDATE、notification_outbox の SELECT/INSERT/UPDATE(payload)）。ルール保存の有効化を進める別セッションと衝突しないよう、適用前に現状を確認する。
3. 変数（cron サービスのみ）: `RESOLUTE_NOTIFICATION_QUEUE_DB_URL`、`TWELVE_DATA_API_KEY`、既存のメール系変数（送信元、配信停止鍵ほか。`mail-preflight.mjs` が不足を名前だけで報告）。
4. 有効化フラグ `RESOLUTE_NOTIFICATION_QUEUE_ENABLED` / `RESOLUTE_MAIL_DELIVERY_ENABLED`。最初はオーナー宛てのテスト1通だけ。
5. 実メール送信（オーナー宛て1通）。

## 未確認
メール事業者のドメイン認証、公開の配信停止ルート、実DBでの通知ロジック、Cronの失敗監視は未確認（`mail-preflight.mjs` の unverified 一覧のまま）。
