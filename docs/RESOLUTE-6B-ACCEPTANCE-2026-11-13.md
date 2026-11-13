# RESOLUTE step 6b: 削除・通知停止の独立保護を本番で一度だけ作る手順 (2026-11-13)

このジョブは、本番 `resolute` DB に「合成ユーザー1件」だけを作り、プラン削除と通知停止を
保護ゲートウェイ経由で独立オブジェクトストアに残す。目的は、あとでバックアップから復元しても
削除済みプランと通知ONが戻らないことを確かめること。実会員のデータには触れない。
お客様向けの保存機能は OFF のまま (`RESOLUTE_PLAN_API_ENABLED` / `RESOLUTE_NOTIFICATION_API_ENABLED` は変更しない)。
本番を変える操作なので、実行前にオーナーの承認を得ること。

## 何をするか (コード: `scripts/resolute/acceptance-6b.mjs`)

APIと同じ `createPlanStore` / `createNotificationStore` と保護バリアを、APIと同じ最小権限ロール
(`resolute_plan_writer` / `resolute_notification_writer`) で動かす。管理者URLは使わない。

1. 事前確認: 合成IDが plans / plan_deletions / protection_outbox / notification_settings のどこにも無いこと。1件でもあれば停止。
2. プラン保存 (plans revision 1) と通知設定 (alerts ON / morning ON, revision 1)。
3. プラン削除 (plans revision 2, plan_deletions 追加, outbox に `delete`)。
4. 通知を両方OFF (notification_settings revision 2)。DBトリガーが `alerts_off` と `morning_off` を outbox に追加。
5. 各操作のあと保護バリアが outbox をゲートウェイへ送り、読み戻して検証し、受領ハッシュを記録。
6. 最後に DB と outbox (3件・すべて受領済み) を読み戻して確認。

結果として独立ストアに入るイベントは3件: `delete` rev 2, `alerts_off` rev 2, `morning_off` rev 2。
(依頼文の rev 1/2/3 とは異なる。実コードでは保存が rev 1、削除が rev 2。通知は2回に分けて切ると
トリガーが `alerts_off` を重ねて記録し4件になるため、3件に収まるよう1回で両方OFFにしている。)

唯一の例外: 合成ユーザーには購読(entitlement)行が無く、ロールにも作る権限が無いため、
そのIDに対する entitlement の SELECT 1文だけをジョブ内で「有効」と答える。他のSQLはすべて実DBに届く。
entitlement 行は作られない。

## ガード

- `RESOLUTE_ACCEPTANCE_6B` がちょうど `true` でなければ `RESOLUTE_ACCEPTANCE_6B_DISABLED` を出して終了コード0。
- ユーザーIDは `^user_acceptance[A-Za-z0-9]{1,100}$`。
- DBは host `postgres.railway.internal`、DB名 `/resolute`、ユーザーはそれぞれ `resolute_plan_writer` / `resolute_notification_writer` 固定。
- 保護ゲートウェイは https の `*.up.railway.app` のみ。バケットの直接認証情報が設定されていれば停止。
- `RESOLUTE_PLAN_API_ENABLED` または `RESOLUTE_NOTIFICATION_API_ENABLED` が `true` なら停止。
- 全体タイムアウト90秒 + コンテナ側 `timeout 120s`。DB文は3秒、ゲートウェイ通信は4秒で打ち切り。
- どのエラーでも即停止。再試行ループ・DROP・鍵の新規作成・スキーマ変更は無い。再実行すると事前確認で停止する。
- 出力は真偽値・イベント名・件数・ステージ名のみ。URL・トークン・鍵・ユーザーIDは出さない。

## 実行手順 (オペレーター)

1. 一時的なRailwayサービスを `resolute` と同じプロジェクト/環境に作る。名前の例 `resolute-acceptance-6b`。
   ソースはこのリポジトリ、Dockerfile は `services/resolute-acceptance-6b/Dockerfile`。
   ドメイン・TCPプロキシ・ボリューム・cron は付けない。再起動ポリシーは NEVER (なし)。
2. 変数 (値は書かない。`resolute-api` サービスの変数への参照にする):
   - `RESOLUTE_PLAN_DB_URL` = resolute-api の同名変数を参照
   - `RESOLUTE_NOTIFICATION_DB_URL` = resolute-api の同名変数を参照
   - `RESOLUTE_PROTECTION_ENABLED` = `true`
   - `RESOLUTE_PROTECTION_WRITER_URL` = resolute-api の同名変数を参照
   - `RESOLUTE_PROTECTION_WRITER_TOKEN` = resolute-api の同名変数を参照
   - `RESOLUTE_PROTECTION_KEY_HEX` = resolute-api の同名変数を参照
   - `RESOLUTE_ACCEPTANCE_6B_USER` = 合成ID (`user_acceptance` + 英数字。実在の会員IDは不可。実行ごとに新しい値)
   - `RESOLUTE_ACCEPTANCE_6B` = `true` (最後に設定する)

   次は設定しない: `RESOLUTE_PLAN_API_ENABLED`, `RESOLUTE_NOTIFICATION_API_ENABLED`,
   `RESOLUTE_PROTECTION_ACCESS_KEY_ID` などバケット直接認証情報、管理者DB URL。
   保護ゲートウェイ(別サービス)が起動中で、ストアへ書ける状態であること (`RESOLUTE_WRITER_ENABLED=true`) を事前に確認する。
3. デプロイして1回だけ実行する。Run now / 再デプロイの繰り返しはしない。
4. 期待するログ (1行のJSON):
   - 成功: `RESOLUTE_ACCEPTANCE_6B_OK` — `events` に `alerts_off` / `delete` / `morning_off` (各 `published:true`)、`objects:3`、`customerSaving:false`。
   - 失敗: `RESOLUTE_ACCEPTANCE_6B_FAILED` と `stage` (`config` / `preflight` / `already-present` / `plan-save` / `notification-on` / `plan-delete` / `notification-off` / `verify` / `timeout`)。
     失敗したら再実行せず、ステージを報告して止める。途中まで進んだ行は残るため、原因を調べてから新しい合成IDで判断する。
   - 設定未完 (フラグ未設定) のときは `RESOLUTE_ACCEPTANCE_6B_DISABLED`。
5. 確認:
   - ゲートウェイ側ログにPUT 3件・GET読み戻し。オブジェクトストアの `resolute/protection/events-v1/` に3件増えている。
   - 既存の独立在庫確認(`protection-maintenance.mjs` の在庫/封印手順)で3件を認証できること。
   - DB (読み取りのみ): 合成IDの plans は revision 2 で plan 無し、notification_settings は revision 2 で両方 false、
     protection_outbox 3行すべて published_at / receipt_sha256 あり。
6. 一時設定を戻す:
   - `RESOLUTE_ACCEPTANCE_6B` を `false` (または削除) にして再デプロイし、`RESOLUTE_ACCEPTANCE_6B_DISABLED` を確認。
   - 保護関連の参照変数 (`RESOLUTE_PLAN_DB_URL` など6件と `RESOLUTE_ACCEPTANCE_6B_USER`) を外す。
   - 一時サービスを削除、削除できない間は変数を全部外した状態で停止のまま残す。
   - `RESOLUTE_PLAN_API_ENABLED` / `RESOLUTE_NOTIFICATION_API_ENABLED` が `false` のままであることを確認。
   - 後続の復元確認で新しい在庫の封印(pin)が必要なら、その手順で更新する (このジョブは pin を更新しない)。

## 元に戻せないもの

専用ロールには DELETE 権限が無く、独立ストアは上書き・削除ができない設計のため、
合成ユーザーのDB行 (plans, plan_deletions, notification_settings, notification_suppressions, protection_outbox)
と、独立ストアの3オブジェクトは恒久的に残る。クリーンアップで消さないこと。実会員のデータではない。

## 復元確認での注意

この実行のあとに取ったバックアップには、すでに削除・停止済みの状態が入る。
「復元してもプランと通知ONが戻らない」ことを示すには、このジョブの実行前に取ったバックアップを使うこと。
