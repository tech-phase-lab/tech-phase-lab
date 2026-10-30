# 通知設定：変更前の調査（2026-10-30）

実装変更前に記録。調査対象は `codex/research-preview` の upstream
`00bdcb9f` を取り込んだ作業ツリー。秘密値・購読データの実値は取得していない。

| 種類 | 送信元 | 対象・既存条件 |
| --- | --- | --- |
| 目標株価 | `service.py:run_web_push` → `web_push.deliver` | 公開目標株価の変化。active端末、tickers一致または`*`、登録後に観測した新鮮なイベント、送信済みキーなし、送信前に現在のPRO権限を確認 |
| 決算 | 同じループが `market_results.public_feed` の earnings を上記deliverへ渡す | 同じ購読・銘柄条件。結果を企業・四半期・月単位で重複排除。見通しだけの記事は除外 |
| 銘柄ニュース | **スマホ送信処理なし** | `news-stream.ts` 等のSSEは画面更新用。スマホWeb Pushの経路ではない。`web_push.send`、`push_devices`、pywebpushの全呼出箇所を確認 |
| 銘柄手帳 | `web_push.deliver_weekly` | 日曜20〜23時JST、active・会員所有・weekly_notebook=1・現在PROの端末にISO週1回。本文は共通の手帳への案内。ウォッチ銘柄別本文ではない |

別経路：`release_watch.check` は運営者だけに掲載遅延/掲載完了を通知する
運用監視。上記の会員向け4スイッチとは別用途で、今回変更しない。

保存先はresearch-monitorの `self.app.db_path` のSQLite（会員決済Postgresとは別）。
`web_push.connect` が既存スキーマを追加移行する。

- `push_devices`: id=endpointのSHA256、subscription=endpointとp256dh/authキーのJSON、
  tickers=JSON配列（`["*"]`可）、language、since、active、owner_id、access_until、weekly_notebook。
- `push_deliveries`: 端末idとイベントキーの複合主キー、状態、試行時刻など。通信前に予約し重複防止。
- `push_test_attempts`: 端末別テスト通知の直近試行時刻（1分制限）。

画面は `notification-page-view.tsx` が3スイッチとニュース銘柄をlocalStorageに保存。
`notification-settings.tsx` は手帳のみ登録APIのweeklyNotebookへ渡す。
既存の端末登録は全銘柄（allTargets=true）。

認証：`/api/research/notifications` が既存getMembershipでログイン・PRO期限を確認。
サーバーが確定した会員id/期限と購読を、秘密Bearerでresearch-monitorへ転送。
Python側も会員id・endpointハッシュ・購読全体の一致を確認。購読情報はURLに入れない。

実装範囲：本人の端末別設定API、既存送信のカテゴリ判定、ニュース用の共通判定を追加。
ニュース送信元の新設や収集/翻訳/表示変更は行わない。新規ニュース送信元が未存在のため、
本番ニュース送信への適用は接続待ちとして記録する。画面はClaude向けAPI仕様を渡す。
