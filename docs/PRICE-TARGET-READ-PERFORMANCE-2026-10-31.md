# 目標株価の初回読み取り改善 — 2026-10-31

## 調査

- `AutomaticMonitor.public_price_targets` は取得のたびに共通の `db_lock` を取り、`monitor.connect` の初期化・マイグレーションを通り、さらに `signals.schema` を実行していた。
- このロックは取得・書き込み処理と共有されており、公開済みの値を読むだけでも処理待ちが発生する。
- Railway の `/price-targets` の HTTP 記録に 2026-10-31 11:07:46 UTC の 5,694 ms、12:02:12 UTC の 3,324 ms を確認。同日の別リクエストは 74–993 ms。遅延は初回だけとは限らない。
- 作業環境から本番 API を計測すると 6.45 / 5.48 / 5.52 秒。ただし、DB を読まない stream チケット API にも約8秒かかる測定があり、作業環境の通信時間を含む。すべてをDB待ちと断定せず、反映後はRailwayの処理時間も比較する。

## 変更

- `price_target_reader.read` を追加。SQLite の読み取り専用接続と読み取りトランザクションで、既存の `price_target_projection` をそのまま利用する。
- 目標株価の HTTP / SSE 共通の読み取りから、共通ロックと毎回のスキーマ初期化を外した。
- WAL の確定済みデータを読む。書き込み中の未確定データは見せず、確定後の次回取得には反映する。`immutable` 接続や古い結果の長期キャッシュは使わない。
- DBがない・初期化されていない場合は成功した空一覧を返さず、既存のエラー処理に渡す。
- 件数、並び、掲載条件、期限、公開フィールド、認証、表示、ニュース処理、インフラ設定は変更しない。

## 検証

- 専用4テスト通過。従来と同じ内容、書き込み中かつ共通ロック保持中の初回読み取りが1秒未満、コミット後の反映、削除・期限切れ、存在しないDBへの書き込み防止を確認。
- 全件検証通過: `npm test` 1,703件、`npm run test:python` 2,682件、lint（0 errors / 既存11 warnings）、production build、compileall、diff check。
- 表示確認はユーザー指定によりClaude担当。ブラウザのログイン・表示確認は行わない。

## 反映先

- 本番 `techphase.app` の目標株価 stream チケットAPIが返す接続先は `research-monitor-staging-research-staging.up.railway.app`。トークンは記録・出力していない。
- 対象サービスは `research-staging` 環境の `research-monitor-staging`。既存の `codex/research-preview` 接続と `/scripts/research/**` の監視設定で反映する。
- 設定変更・他サービスの再デプロイ・mainへのマージは不要。反映前の成功デプロイは `3bae135c-05e5-4014-a087-1db15c7f974a`。
