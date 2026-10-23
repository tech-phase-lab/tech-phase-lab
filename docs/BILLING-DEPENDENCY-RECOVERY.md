# 決済連携サービスの依存ライブラリ保管・復元検査

対象は `services/tech-phase-billing` の専用lockfileと対応する依存。
本番決済・Sandbox取引・DB接続を実行せず、復元したファイルからの起動と
決済無効時の応答だけを検査する。実際のR2保管結果は別途実行ログで確認する。

## 実行経路

`.github/workflows/billing-dependencies-external-backup.yml` は指定previewブランチで
自身または専用requestファイルが更新された場合のみ実行する。定期実行・デプロイはない。
既存の4つのGitHub Secretsと `resolute-backup-external` を再利用する。
新しい鍵の発行や入力は不要。インストール工程には保管用認証情報を渡さない。

1. Node24.22.1 / Ubuntu24.04で専用lockfileを用いてnpm ciする。install scriptsは無効。
2. 既存の検証器で依存ファイル一覧・ハッシュ・プラットフォームを固定する。
3. 同じcommitのソースと依存をAES-GCMで暗号化し、R2へ条件付き書き込みする。
4. R2から実際に取り出した暗号文を認証・復号し、lockfile、全ファイル、実行環境を照合する。
5. 別ディレクトリの同commitソースへ復元依存だけを置く。追加npm installはしない。
6. カーネルのネットワーク隔離下で実サーバーを起動し、17項目のHTTP応答を確認する。
   外部接続を拒否する子プロセス側ガードも自己検査する。実認証情報は引き継がない。

17項目は2構成のhealth、認証情報なしの4経路×2構成、架空の内部認証を使った
決済無効の4経路、無効Webhook×2構成、存在しない経路の拒否。
Sandbox取引とWebhook処理は常にOFF。実DB・PayPal資格情報は設定しない。
完了ログは `BILLING_RESTORED_BOOT_OK` と `BILLING_EXTERNAL_OFFLINE_BOOT_OK`。
デプロイSUCCESSや設定一致だけでは保管・復元成功と扱わない。

## 境界

ライブラリ復元と無効状態での起動を検証する。取引・課金・本番決済台帳の復元は未検証。
Node本体とコンテナベースイメージは含まれない。Ubuntu24.04の検査結果は、
Bookwormの既存DockerfileやRenderでの稼働を証明しない。
復元器はNode・ABI・libcの不一致を拒否する。対応する実行環境の保管を後続で行う。

本番DBの新しい完全な書き込み停止下の一覧、削除・通知停止履歴、隔離復元は別の必須条件。
保存機能を有効化せず、使用済みAI診断claimも再利用しない。
Railwayへの再接続、朝ジョブ・確認予約、課金設定、承認済みUIは変更しない。

## 手元での事前検証

専用lockfileの14パッケージ・139ファイルを一時鍵で暗号化・復号し、
独立したソースディレクトリで17項目の起動検査に成功。`pg` を取り除くと
起動検査は失敗し、成功ログを出さないことも確認した。
この一時試験はR2保管の証拠ではない。実保存結果は別の実行記録で追記する。

## 実行環境保管の残り

リポジトリの起動定義を確認した。タグの存在やライブラリの保管だけで
ベースイメージ保管済みとは扱わない。実イメージのdigest固定・暗号化保管・
外部レジストリを使わないロードと起動確認を次段階にする。

| 対象 | 現在のベース指定 | 未保管・未検証の対象 |
| --- | --- | --- |
| API・決済 | node:24.22.1-bookworm-slim | Node本体、Bookworm環境、同環境での依存復元 |
| 履歴保管 | node:22.23.4-bookworm-slim | Node本体、Bookworm環境、履歴保管の起動 |
| 監視 | python:3.12-slim | Python本体、推移依存、SQLiteを含むデータ |
| DBバックアップ・隔離復元 | postgres:18-bookworm | PostgreSQLツール、Python依存、復元用Node本体 |

監視のPythonとPostgreSQLのタグはパッチ番号・digestが固定されていない。
既存環境の同一物を取り出したとは主張しない。本番の起動定義は今回変更しない。

## Render接続に残る制約

`services/tech-phase-billing/transport.mjs` の `transportConfig` はHTTPSの
`.up.railway.app` ホストのみを許可している。バックエンドにも
`TECH_PHASE_BILLING_RUNTIME=railway-sandbox` と previewブランチの確認がある。
コンテナをRenderに置くだけではフロントから接続できない。
切替準備では、承認した接続先の明示的な許可と復旧環境の識別を実装・検証する。
ホスト制限や認証を一律に外して回避しない。本番の接続制限は今回変更しない。
