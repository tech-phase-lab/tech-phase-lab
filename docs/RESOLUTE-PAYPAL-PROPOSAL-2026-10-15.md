# RESOLUTE PayPal接続案 — 2026-10-15

状態: 会員ごとのOrders API方式と下記の返金・通知方針は2026-10-15 JSTにユーザー承認済み。決済コード・販売開始・利用権付与は未実装。ユーザーが金額と通貨を確認済みの8リンクを下記に保存する。固定リンクによる支払い受付を安全な会員別決済と同一視しない。

## 確定済み価格とリンク

| 用途 | 日本語 / JPY | 英語 / USD |
|---|---|---|
| 初回・発売価格 | 7,980円 https://www.paypal.com/ncp/payment/XWR7XAUFE7ZBA | $59 https://www.paypal.com/ncp/payment/R662PKWJ5TQ9L |
| 初回・通常価格 | 9,800円 https://www.paypal.com/ncp/payment/TMDAEUUHRZGTU | $69 https://www.paypal.com/ncp/payment/FQ7MAXHT866HS |
| 1年更新・FREE | 5,980円 https://www.paypal.com/ncp/payment/EG8CAUCJ69TTQ | $39 https://www.paypal.com/ncp/payment/FNCGPSDQBTPAA |
| 1年更新・PRO | 3,980円 https://www.paypal.com/ncp/payment/XB6DJ9FP79Y98 | $29 https://www.paypal.com/ncp/payment/AZYY37M55CKEG |

初回は買い切りツール利用権とアラート・危険度チェッカー1年間。更新は1年ごとの都度購入、自動継続なし。先着人数制限なし。

価格切替の絶対時刻: `2027-03-01T00:00:00+09:00` = `2027-02-28T15:00:00Z`。国・端末時計によらず全購入者共通。発売開始日は未確定のため勝手に販売を開始しない。

ユーザー指定の販売文:
- 日本語: 発売記念価格は7,980円です。2027年2月28日までの期間限定で、3月1日からは9,800円になります。
- English: Launch price: $59, available until February 28, 2027. From March 1, the price is $69.

英語では指定文を維持して別途 `All dates are in Japan Standard Time (JST).` を添える案。期限後は通常価格の現在形へ切替。ページ表示だけでなく購入ボタン押下・支払い確定前にサーバー時計で再判定する。

## 固定リンクの制約

PayPalの固定リンクはサイトを経由せず共有URLから決済できる。サイトの非表示・認証付きリダイレクト・Webhookで付与を拒否するだけでは、FREE利用者の割引支払い自体を防げない。PayPal側にTech PhaseのPRO資格の判定機構があると仮定しない。

同様に期限後のサイトのリンク差替えだけでは古い発売価格URLへのアクセスを止められない。厳密な制限を満たす案としてPayPal Orders APIによる会員別注文作成を推奨。既存8リンクは価格・商品設定の確認資料として保持し、会員別決済導入時は固定リンクを迂回経路として残さない運用が必要。PayPal側のリンク停止は承認された移行時に行い、今回勝手に削除・停止しない。

## 提案フロー

1. 購入前にClerkへログイン。確認済み会員メールを必要とする。ブラウザのuserId・PROフラグ・指定金額は信用しない。
2. サーバーで初回/更新・表示言語・現在時刻・実際のPRO資格を検証。更新は有効な買い切り利用権の所有者だけ。運営者プレビューやテストPROを割引資格として使わない。
3. 専用DBへランダムな内部注文ID、Clerk userId、商品resolute_v1、言語、通貨、最小通貨単位の金額、価格区分、有効期限、資格根拠を記録。PayPal Orders APIで注文を作り、custom_idには内部注文IDを設定。個人メールやClerk IDを直接載せない。
4. PayPal注文IDと本人の対応をサーバー保存し、承認後のcaptureも本人セッションに限定。金額、通貨、受取商店、状態、有効期限、所有権、PRO資格を再確認してから実行。期限をまたいだ安い注文は再作成し、変更額を購入者に示して再承認する。古い注文を勝手に値上げして引き落とさない。
5. 署名検証済みPAYMENT.CAPTURE.COMPLETEDとPayPal照会で支払い完了を確認。APPROVEDや戻り画面へのアクセスだけでは権限を付与しない。同期captureとWebhookは共通処理へ集約し、イベントID/注文ID/capture IDの重複処理を防ぐ。
6. 注文・支払い台帳と利用権を専用DBの同一トランザクションで更新。支払い確定時点のPRO資格を履歴と照合する。予期しない期限跨ぎ、不一致、返品・取消等は要確認として保持し、勝手な返金・差額請求はしない。

メールの扱い: 利用権はログインしたClerk userIdへ付与する。PayPalメールと会員メールは異なってもよいため、メール一致だけで会員を探索して付与しない。メールは補助照合と連絡先確認に用い、注文紐付けが欠落した支払いを推測で自動付与しない。新しい確認メール送信は今回行わない。

期間の案: 初回の支払い完了から暦上の1年。更新は max(現在の期限, 支払い完了日時) から暦上の1年。期限前更新で残り日数を失わせず、期限切れ後の空白期間は埋めない。うるう日の翌年は2月末とする案。正式な発売日、期間計算、例外時の精算方針を確定してから実装する。

## 実装後の検証条件

日英の価格、JST切替直前/直後、海外端末・時計変更・開きっぱなし画面、PRO期限切れ、FREEの直アクセス・改ざん・他人の注文、未購入者の更新、Webhook偽装・重複・遅延、capture通信失敗後の復旧、支払いとDB更新の整合をSandboxで検証する。PayPal本番のアプリとWebhookは必要になるが、秘密値はチャットに貼らない。実課金テストやメール送信は別途許可なしに行わない。

参考（確認日2026-10-15）:
- https://developer.paypal.com/payment-links-buttons/create-payment-link/
- https://developer.paypal.com/api/payment-links-buttons/
- https://developer.paypal.com/api/orders/v2
- https://developer.paypal.com/api/rest/webhooks/rest/

## 2026-10-15 JST 承認と準備状況

- 会員別注文、サーバー価格決定、実PRO資格の注文時・capture直前確認、検証後のみ付与、重複排除、偽通知拒否、取消記録、旧固定リンク停止、異常通知を必須条件としてユーザー承認済み。
- 全額返金・支払い取消は該当購入の利用権停止。一部返金・異議申し立ては一時停止し、確認後に復旧または停止確定。別の正常購入の権利を無条件に削除しない。
- 運営画面への記録と指定メールへの決済異常通知を承認済み。通知先は会話内で指定済み。個人の通知先を公開リポジトリやクライアントへ埋め込まず、サーバー専用設定に保存する。メールサービスの契約・課金、顧客へのメール送信まで承認されたとは扱わない。
- ユーザー報告: Sandboxアプリ作成、Client ID/Secretの確認、テストアカウント確認まで完了。Webhook受信URLとWebhook登録は未準備。秘密値はチャットへ要求しない。
- 現在は通知先を受領した段階。環境変数登録・メール配信・旧固定リンク停止・公開サイト反映は未実施。

## 2026-10-15 15:35 JST 設定反映確認

ユーザーがRailwayのresolute-api / productionへ次の5変数を追加してDeployを実施。describe-serviceでdeployment `d6c7b39b-f714-48f7-a18a-9a59c95bc2f1` SUCCESS、staged=null、5変数名の存在を確認。値は取得していないため、Sandbox認証の成功までは未検証。

- `RESOLUTE_PAYPAL_ENV`（指定値 sandbox）
- `RESOLUTE_PAYPAL_CLIENT_ID`
- `RESOLUTE_PAYPAL_CLIENT_SECRET`
- `RESOLUTE_PAYMENT_ALERT_EMAIL`
- `RESOLUTE_PAYMENTS_ENABLED`（指定値 false）

次に実装するコードは上記の変数名に合わせる。現在のAPIはentitlement readerとしての構成であり、これらの登録だけでは決済受付、付与、メール通知は動作しない。決済台帳と限定writer、会員資格のサーバー照会、Webhook登録・検証、通知送信元の設定、Sandboxの通し検証が必要。既存readerを管理者権限に拡大しない。サービスURL: https://resolute-api-production.up.railway.app 。Webhookのパスは未実装で、未確認の受信URLをユーザーへ登録させない。
