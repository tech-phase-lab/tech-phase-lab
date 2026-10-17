# Restricted Sandbox tester

The owner requested a separate test account for PRO-price acceptance, keeping
their everyday membership unchanged. A single server-configured Clerk ID may
enter Sandbox checkout until an explicit UTC expiry. Missing or malformed
configuration denies access. Vercel admission is Preview-only; the backend also
requires the existing Sandbox PayPal configuration. Admission is rechecked per
API request and never grants PRO status or product rights. Audit access remains
owner-only; existing per-order ownership and payment verification remain intact.

Configuration: `RESOLUTE_SANDBOX_TEST_USER_ID` and
`RESOLUTE_SANDBOX_TEST_UNTIL` (ISO UTC with `.000Z`). Set only on the requested
preview branch and the dedicated Sandbox payment backend. Do not commit identity
values or emails. Remove the configuration after acceptance.

The USD FREE renewal reported on October 16 was checked against the actual
Sandbox ledger by a read-only transaction: USD 39.00, renewal/free, paid,
one active grant and one grant audit entry. Its period starts at the preceding
expiry, October 15, 2028 15:18:51 UTC, and ends October 15, 2029 15:18:51 UTC.
No payment, grant or membership was modified by that inspection.

PRO-price PayPal payments remain unverified. The new tester still needs an
appropriate server-side PRO qualification and a verified Sandbox initial
purchase before testing renewal. No actual membership upgrade, email dispatch,
live payment, or production entitlement is performed by this change.

## Owner-only PRO preparation — October 16

The user cannot edit Clerk Private metadata in the dashboard; repeated attempts
in other chats failed. Do not ask them to repeat that procedure.
`/resolute/checkout/setup` now provides a Japanese owner-only button. Its POST
handler uses the existing server Clerk client to deep-merge a temporary PRO plan
onto the single configured tester, never onto the caller or a request-supplied ID.
Preview, exact owner session, same origin and a custom request header are required.
The tester must have a verified primary email, must not be banned/locked/admin,
and must not have an existing paid membership. Expiry is server configured, must
be within seven days, and is never extended by retry. Both frontend and backend
continue to enforce the existing Sandbox tester expiry. The write records its
actor/date in private metadata, emits a sanitized operation log, and is read back
before success is shown. Other metadata is preserved. No new credential copy,
payment, product grant, notification or charge is performed by preparation.

This is a real, temporary PRO qualification on the dedicated test identity; it
is separate from the owner's presentation-only membership preview. After expiry,
the plan resolves to FREE. Actual PRO-price payment acceptance remains pending.
The latest supplied initial order was independently checked: JPY 7,980 paid at
2026-10-16 05:27:42 UTC, one active initial grant and one grant audit entry.
The read-only ledger report did not expose its member ID, so the order-to-tester
identity match has not yet been independently verified.

## Acceptance update — October 16, 2026 06:05 UTC

This supersedes the earlier pending PRO-payment statements above.
The owner-only setup completed at 05:52:45 UTC and its read-back succeeded.
The setup release passed all GitHub checks, including PostgreSQL concurrency.
The user then completed both PRO renewal flows. Each supplied order was checked
separately against the actual Sandbox ledger using the read-only verifier:

| Renewal | Paid at (UTC) | Prior expiry / new start (UTC) | New expiry (UTC) |
| --- | --- | --- | --- |
| JPY 3,980 / pro | 2026-10-16 05:57:21 | 2027-10-16 05:27:42 | 2028-10-16 05:27:42 |
| USD 29.00 / pro | 2026-10-16 06:03:40 | 2028-10-16 05:27:42 | 2029-10-16 05:27:42 |

Both orders: paid, product resolute_v1, payment/capture IDs present, exactly one
active renewal grant and one SANDBOX_ACCESS_GRANTED audit record. Each extends
from the preceding expiry with no gap. Inspections performed zero writes.
The verifier does not disclose member IDs; do not claim an independently read
order-to-Clerk-ID match from this output alone.

Sandbox paid-order coverage now includes Japanese and English launch purchases,
FREE renewals and PRO renewals. This does not establish live-sale readiness.
Live entitlement projection, actual email/alert delivery, fixed-link retirement,
payment-table backup/restore and dispute delivery/reconciliation still need their
own acceptance evidence. Do not enable live charges, new paid plans or email
delivery without the applicable authorization. Tester admission and temporary
PRO qualification expire at their existing configured deadline; setup does not
extend that deadline. No further purchase is needed for these six price cases.

## 2026-10-16 — Sandbox購入台帳からの利用権判定

`GET /internal/v1/payments/access` を追加。既存のサービス間認証・本人Clerk認証・期限付きSandbox許可リストを通過した本人だけが照会できる。userId等のquery指定は拒否。Sandbox専用台帳の注文と付与記録を一つのSQL snapshotで読み、商品・会員・購入種別・確定済み支払いの一致を要求する。戻り画面やPRO属性から利用権を作らない。

初回購入はツールの無期限利用、初回/更新はそれぞれの通知期間として判定する。連続した期間だけを結合し、返金された更新期間の穴を埋めない。初回購入の返金・停止時には更新記録が残っても両方の能力フラグをfalseにする。注文か付与記録のどちらかが停止していれば許可しない。返金履歴・重複排除は既存の台帳/auditを使い、別の非同期コピーを作らない。

この応答は必ず `sandbox: true`。通常の `/internal/v1/entitlements`、`resolute.entitlements`、本番ツール、通知ジョブには接続しない。DB移行・追加権限・本番決済・メール送信なし。本番利用権への接続は未完了であり、この変更を本番販売の完成扱いにしない。


## 2026-10-16 — 購入ページでの利用権照会

テスト購入ページに「テスト利用権を確認する」を追加。注文作成・支払い操作なしで、本人のSandbox購入台帳に基づくツール/通知の可否と通知期間を確認できる。日時は日英とも日本時間。表示言語の切替で注文や照会結果を失わない。支払い状況を再確認すると古い利用権表示を消す。照会失敗時は古い「利用可」を残さず、再確認の案内を表示する。

ローカルで実コンポーネントを描画し、APIだけを試験応答へ差し替え、日英320/390/430pxの横はみ出しなし、言語切替で注文/金額/利用権保持、注文作成1回・確定1回・ページ再読込なし、照会失敗後の古い判定消去を確認。これは認証付き公開URLの本人照会成功やSafari実機検証を意味しない。

画像確認で既存フォントに決済関連の日本語文字不足を発見。README記載のSHA-256と一致する同じ公式原本から、既存文字をすべて維持して現在のRESOLUTE文言を追加収録する。本番利用権・メール送信・実請求は引き続き有効にしない。

先行API変更1bd2fc5のVercel/Railwayデプロイ成功、実API healthz 200と認証なし照会401を確認。GitHub PostgreSQL同時実行jobは成功。全体jobは別担当の後続pushでcancelledとなり、先行commit単体のCI全体成功とは扱わない。企業紹介b568f37を保持して今回の最終ツリーで再検証する。

## 2026-10-16 — 決済台帳の復元検証を追加（未デプロイ）

従来の復元処理はDB全体を復元するが、内容検証はサンプル2行だけだった。
隔離復元DBで決済5テーブルを読み、注文と利用権の会員・商品・種別・確定記録・状態、
付与監査が1件だけ存在すること、paid注文に付与記録があることを確認する。
返金済み注文の利用権がactiveに戻っていた場合は成功扱いにしない。
決済スキーマのない古いバックアップも決済復元の合格にはしない。
ログはテーブル別件数だけで、会員ID・決済ID・メールや購入内容を出さない。

この検証は復元先内の整合性検査であり、元DBとの全行一致証明ではない。
既存の暗号化ファイルとdumpのチェックサム検証を維持する。
ローカルPGliteでスキーマ欠落、付与欠落、監査欠落、別会員、返金後の不正復活、
商品不一致を検出し、整合した購入と取消記録を通すことを確認した。
実Bucketからの復元・Railway更新は未実施。費用抑制のため次のまとめた公開対象とする。
通常の購入権限、本番決済、メール送信の稼働状態は変更しない。

最終ローカル検証：Node 952/952、Python 2467/2467、lint 0 errors（既存警告2件）、
Next.js build、compileall、git diff --check成功。基点は他担当更新を含む394f6d1。
## 2026-10-16 07:21 UTC — 実バックアップで決済台帳の復元確認

既存バックアップ ac7a5ff8-0107-4d72-a70d-cd6f888077bf が成功（暗号化20,148 bytes、dump19,948 bytes）。更新した既存隔離復元サービス a5e7b373-11fe-4296-bbb1-407c6f890d12 で RESOLUTE_RESTORE_OK を確認。注文11件、利用権7件、イベント8件、監査32件、通知待ち7件を読み、sandbox_payment_integrityを含む全検査が成功した。両deploymentはSUCCESS、monitor_ping_sentはtrue。本体DBへの復元・メール送信・本番決済・課金設定変更は行っていない。復元サービスの実行コードだけを更新し、既存の週次スケジュールと隔離構成を維持した。これは本番販売や独立削除履歴の復元確認を意味しない。
