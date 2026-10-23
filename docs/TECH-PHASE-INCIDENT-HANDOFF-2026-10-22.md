# 2026-10-22 最新状況とPRO作業再開条件

## ユーザー報告を優先する最新状況

- Claudeとの対応で進展済み。古い作業ログだけを根拠に設定・返金・配備を繰り返さない。
- 新しいものへ変更したのは **OpenAI APIキーとX APIキーだけ**。他の鍵を交換済みとは扱わない。
- 変更先すべてへの反映・旧キーの失効・新キーによる実行成功は、それぞれ別の確認事項。今回の報告だけでは完了としない。
- Railway側で更新できず、稼働環境は旧バージョン。ニュース・目標株価等は停止中との報告。
- 本番開始前の環境での出来事。本番運用が復旧した等の表現はしない。
- 15:05の共有画像ではresolute-backupとPRO backupが失敗、PostgresはOnline。DB消失やクラッシュ原因はこの表示だけでは確定しない。
- Railwayへの接続、Run now、デプロイは行わない。ニュース・決算取得、RESOLUTE、mainの変更禁止は継続。

## OpenAI登録先の履歴

9月30日午前1時前後の過去会話では、最初にresearch-monitorへ設定し、その後research-staging環境のresearch-monitor-stagingに作成済みの同じキーを登録する案内をしていた。元のresearch-monitorは削除しなくてよいと案内されている。その後の削除は未確認。

これは設定案内の履歴であり、現在の変数値・サービスの存在を再確認した記録ではない。RESOLUTE_OPENAI_API_KEYはコード上にあるが、同じキーの実登録を裏付ける記録は未確認。Xの正確な変更先も今回の報告では指定されていない。推測で一覧を埋めない。

## PROコード上の秘密情報と依存先（実登録一覧とは区別）

実装5a44a2f2を読み取り確認。秘密値は記録しない。以下は復旧時の確認用であり、今すぐ一括交換する指示ではない。

| 変数 | コード上の利用先 | 交換時に確認する関係 |
| --- | --- | --- |
| TECH_PHASE_PAYPAL_CLIENT_SECRET | PRO決済サーバー | 対になるClient ID、Sandboxアプリ、購入・照合・Webhook検証 |
| TECH_PHASE_BILLING_SANDBOX_DATABASE_URL | PRO決済サーバー | 専用DB接続ユーザーのパスワードと接続先 |
| TECH_PHASE_BILLING_SERVICE_TOKEN | PROサーバー、転送クライアント、定期回復 | 呼出し側と受信側の値の一致 |
| TECH_PHASE_BACKUP_DB_PASSWORD | PROバックアップのみ | SELECT専用ユーザー。復元検証には登録しない |
| TECH_PHASE_BACKUP_ACCESS_KEY_ID / TECH_PHASE_BACKUP_SECRET_ACCESS_KEY | PROバックアップ・復元検証 | 専用バケットへのアクセス。暗号化鍵とは別物 |
| TECH_PHASE_BACKUP_KEY_HEX | PROバックアップ・復元検証 | 保存済み世代の復号。旧鍵を捨てると旧バックアップを復号できなくなる |
| TECH_PHASE_BACKUP_MONITOR_PING_URL | PROバックアップ・復元検証 | ジョブごとの監視先。バックアップ成功と通知成功を分けて判定 |

根拠：services/tech-phase-billing/{paypal,database-config,transport,recovery}.mjs、services/tech-phase-backup/{backup.py,README.md}。
確認したPRO決済・バックアップコードにOpenAI/X APIキーの利用はない。これはRailwayに余分な変数が登録されていないことの証明ではない。

## 復旧後の順序

1. Claude側で実施した内容と最新の稼働状態を照合し、未完了の作業だけを抽出する。
2. PROバックアップの失敗ログで停止箇所を特定する。起動しない・DB認証・ストレージ認証・暗号化・監視通知の失敗を区別する。
3. 新しい暗号化バックアップの保存と読戻しを確認する。SUCCESS表示だけで判断しない。
4. 隔離された復元検証を実行し、復号・整合性を確認する。稼働DBへの復元ではない。
5. PRO recoveryが旧版のままかを確認し、必要な場合のみ更新する。対象2会員の集計ログを確認する。
6. 既存購入の実台帳とPayPalの照合、自動復帰、更新決済・異議申立てのSandbox受入を進める。ローカルテスト成功で実受入を代替しない。

本番前の課題7点はTECH-PHASE-LOCAL-CONTINUATION-2026-10-20.mdの2026-10-22節を参照。
この記録の保存はChatGPT全チャットへの自動配布・永続メモリ更新の成功を意味しない。

## 今回のローカル確認結果

5a44a2f2のnpm test：1323件成功、失敗0、スキップ0（152.665秒）。実秘密情報を渡さず、外部HTTP(S)向けプロキシは閉鎖されたローカルポートに設定。決済・DBの実環境受入とは区別する。変更は文書のみ。コミット・push・デプロイは未実施。
