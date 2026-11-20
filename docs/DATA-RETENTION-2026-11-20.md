# 個人データの保管期間と退会時の削除 — 2026-11-20

オーナー承認済みの作業(11月20日)。この文書は、(1) 個人データの保存場所の棚卸し、(2) プライバシーポリシーと実装の差、(3) 今回入れた削除・匿名化ジョブ、(4) 本番で有効にする手順をまとめる。

- 法務ページ(`content/legal/*`, `lib/legal/*`)は変更していない。弁護士の確認待ちのため、文案は §5 に「提案」として置く。
- 今回の変更はすべて **既定で OFF**。マイグレーションはファイルのみで、どのデータベースにも適用していない。デプロイ、変数の変更、Clerk 設定の変更もしていない。
- 保管期間の数字(7年など)は税理士・弁護士の確認を前提にした案。

## 1. 棚卸し(どこに何があるか)

### 1.1 Clerk(アカウント)

| 項目 | 内容 |
| --- | --- |
| 項目 | メールアドレス、ユーザーID(`user_...`)、表示名、ログイン情報・セッション(Clerk 側で端末やIPを保持)、`privateMetadata`(`plan`, `proExpiresAt`, `membershipPreview`, `portfolioReads`, `accountIcon`) |
| 目的 | ログイン、会員種別の判定、PRO期限の表示、アイコン |
| 現在の保管期間 | アカウントがある間。Clerk 側のログ・バックアップは Clerk の規定 |
| 退会時 | 会員画面の削除API(`/api/research/account/deletion`)は `canDelete:false` のまま。ただしアカウント画面に Clerk の `<UserProfile>` を出しているため、Clerk の「ユーザーによるアカウント削除」設定が有効なら、会員は Clerk 上で自分のアカウントを消せる(設定値は未確認・変更していない)。**その場合、下の各ストアのデータは今は何も消えない**(`user.deleted` Webhook の受け口がなかった) |

### 1.2 Tech Phase PRO 課金DB(`tech_phase_billing_live`, `services/tech-phase-billing`)

| テーブル | 個人に関わる項目 | 目的 | 現在の保管 | 退会時(今まで) |
| --- | --- | --- | --- | --- |
| `subscriptions` | `user_id`(Clerk ID)、`paypal_id`、金額・通貨、規約版、状態、日時 | 契約管理 | 無期限 | 何もしない |
| `payments` / `periods` / `events` | 取引ID、金額、支払日、期間 | 支払いの証跡・権利期間 | 無期限 | 何もしない |
| `review_holds` / `adverse_transactions` | 返金・異議の記録 | 不正・返金対応 | 無期限 | 何もしない |
| `recovery_queue` | 契約ID、確認状態 | PayPal との突き合わせ | 無期限 | 何もしない |
| `security_windows` / `security_alerts` | `actor_ref`(ハッシュ)、回数 | 濫用対策(10分窓) | **無期限(削除処理なし)** | 何もしない |

メールアドレスや氏名、カード情報はこのDBにない(PayPal 側)。日次・週次の暗号化バックアップ(`services/tech-phase-live-backup`)は7日分+4週分。

### 1.3 RESOLUTE DB(`db/resolute/*.sql`, `services/resolute-api`)

| テーブル | 個人に関わる項目 | 目的 | 現在の保管 | 退会時(今まで) |
| --- | --- | --- | --- | --- |
| `resolute.plans` | 診断の全回答・ルール(Clerk ID 単位) | 本商品の中心機能 | アカウントがある間。利用者が削除するとトゥームストーン+`plan_deletions` | 何もしない |
| `notification_settings` / `notification_state` / `notification_outbox` | 配信時刻、監視銘柄(最大5)、送信済みの内容 | アラート・翌朝のひとこと | 無期限(outbox も消えない) | 何もしない |
| `notification_suppressions` / `protection_outbox` / `plan_deletions` | Clerk ID、停止・削除の記録 | バックアップから戻したときに削除・停止を元に戻さないため | 無期限 | 何もしない |
| `entitlements` | Clerk ID、利用権の期間 | 利用権 | 無期限 | 何もしない |
| `resolute_payments_live.orders` / `grants` / `audit` / `events` / `alert_outbox` | Clerk ID(またはゲストID)、PayPal注文・キャプチャID、金額、支払日 | 購入の証跡 | 無期限 | 何もしない |
| `renewal_plans` | **PayPal の保管トークン(`token_id`)・顧客ID**、同意日時 | 通知機能の自動更新 | 無期限 | 何もしない |
| `renewal_charges` / `renewal_notices` | Clerk ID、更新の試行・お知らせ | 自動更新 | 無期限 | 何もしない |
| `guest_receipts` | 宛先・送信元のハッシュ | ゲスト購入の領収書 | 無期限 | (ゲストは対象外) |

メールアドレスはDBに置かず、送信時に Clerk から取得(Resend で送信)。

### 1.4 研究モニターの SQLite(`scripts/research`, Railway volume)

| テーブル | 個人に関わる項目 | 目的 | 現在の保管 | 退会時(今まで) |
| --- | --- | --- | --- | --- |
| `push_devices` | **Clerk ID(`owner_id`)そのもの**、Push の endpoint と鍵、銘柄、言語、各種通知設定、`question_owner` | Web Push | 端末を外すまで。PRO が切れても `active=0` で行は残る | 何もしない |
| `push_device_preferences` / `push_deliveries` / `push_notices` / `push_test_attempts` | 端末ID、送信履歴、テスト送信時刻 | 配信・重複防止 | deliveries/notices は7日。preferences・test_attempts は無期限 | 何もしない |
| `member_saved_research` | 保存した記事、マーカー・メモ(本文の引用を含む) | 保存・ノート | 無期限(HMAC キー単位) | 何もしない |
| `member_favorite_lists` | ウォッチリスト、価格アラート | お気に入り | 無期限 | 何もしない |
| `member_questions` | リゼルへの質問本文(日本語・英訳)、状態 | リゼルに聞く | 無期限。利用者が消しても行と本文が残る(件数のため) | 何もしない |
| `desk_reactions` | Notes へのリアクション | リアクション集計 | 無期限 | 何もしない |
| `question_translation_*` | 質問IDと翻訳の記録 | 翻訳 | 無期限 | 何もしない |

キー: 保存・お気に入り・質問・リアクションは、ウェブ側が `RESEARCH_MONITOR_TOKEN` で作る HMAC(`saved-research:` / `favorites:` / `question:` / `desk-reaction:` + Clerk ID)。モニター内のローカルバックアップは `RESEARCH_BACKUP_RETENTION`(既定24世代)、外部バックアップ(`services/tech-phase-research-backup`)は別途。

### 1.5 ログ

| 場所 | 内容 | 保管 |
| --- | --- | --- |
| Vercel(ウェブ) | 実行ログ。会員ID・メール・トークンは出さない方針(イベント名・段階・時間のみ)。アクセスの IP・UA は Vercel 側 | Vercel のプラン既定(要確認・変更していない) |
| Railway(モニター・課金・RESOLUTE) | アクセスログ(送信元アドレスとパス)、件数だけの処理ログ | Railway のプラン既定(要確認・変更していない) |
| 外部AI | ポートフォリオ画像の読み取り(OpenAI / Anthropic)、質問の英訳(LLM) | 各社の規定 |

## 2. プライバシーポリシー(現行文)と実装の差

| # | ポリシーの記載 | 実際 | 対応 |
| --- | --- | --- | --- |
| 1 | §5「退会をしたときは、法令で保存が必要なものを除き、バックアップを含めて●日以内に削除」 | 退会の仕組みがなく、Clerk で消されても下流のデータは残り続ける。日数も未定(●) | 今回のジョブで下流削除を実装(OFF)。日数案は §5 |
| 2 | §2「バックアップには最長●日間残る」 | 研究DB: 24世代(既定)、課金DB: 7日+4週(最長約35日)、RESOLUTE: 別管理 | 日数案は §5(35日+α) |
| 3 | §1「設定情報: 表示言語、通知の設定、お気に入りの銘柄」 | 記事の保存、**マーカー・メモ(本文の引用)**、**リゼルへの質問本文**、Notes へのリアクション、価格アラートもサーバーに保存 | 取得情報に追記する案 |
| 4 | §1「通知情報: 端末の識別情報」 | Push の endpoint・鍵に加え、**Clerk ID を平文で** `push_devices.owner_id` に保存。PRO が切れても行が無期限に残る | 90日無効の端末を自動削除(OFF)。記載はそのまま使える |
| 5 | §5「利用目的に必要な期間」 | 期間の定めのない表(上の「無期限」)が多い | §4 の期間表を採用し、ポリシーに表で載せる案 |
| 6 | 支払記録の保存期間の記載なし | 課金・購入の記録は削除処理がない | 7年保存(税法)を明記し、退会時は ID を外して保存する案 |
| 7 | §9 外部事業者: Clerk, PayPal, メール・通知、Push 各社 | **ポートフォリオ画像を OpenAI / Anthropic に送って読み取る**。**質問文を LLM で英訳**。メール送信は Resend | 外部事業者に「AI による画像の読み取り・翻訳」を追記する案 |
| 8 | §2「持ち株はサーバーに保存しない」 | 保存はしないが、画像の読み取り時に外部AIへ送信 | 上と同じ追記 |
| 9 | RESOLUTE 自動更新の保管トークン | `renewal_plans` に PayPal の保管トークンを保存(規約 第21条4項は「自動で課金しない」) | 規約との整合は別件(本PRの範囲外)。退会時は削除するよう実装 |
| 10 | 利用者が削除した質問 | 本文が行に残る | 30日後に本文を消す(OFF) |

## 3. 今回の実装(すべて既定 OFF)

### 3.1 流れ

```
Clerk でアカウント削除
  └ user.deleted Webhook (Svix 署名) ─▶ app/api/webhooks/clerk/route.ts
        ├ 署名・時刻の検証 (CLERK_WEBHOOK_SIGNING_SECRET)
        ├ オーナー2アカウントは拒否(200で何もしない)
        ├ MEMBER_ERASURE_ENABLED != true なら 503(Svix が再送)
        └ モニター POST /member/erase  (Clerk ID + 4つの HMAC キー)
              ├ Push 端末と関連行、保存・ノート、ウォッチリスト、リアクションを削除
              ├ 質問は行を残し、本文を空にし、持ち主キーを質問ID由来の値に置換
              ├ 受付記録: ランダムな受付番号と件数のみ(会員IDなし)
              └ Postgres 手順を member_erasure_requests に積む
scripts/member-erasure-job.mjs (定期実行)
  ├ GET /member/erasure-requests
  ├ tech_phase_billing_live.erase_member(id)   … db/tech-phase/009
  ├ resolute.erase_member(id)                  … db/resolute/026
  ├ 各手順の完了を POST /member/erasure-requests/ack(全部終われば会員IDを消す)
  └ RESEARCH_RETENTION_PURGE_ENABLED=true なら purge_expired() を両DBで
モニター: バックアップのたびに RESEARCH_RETENTION_PURGE_ENABLED=true なら期限切れデータを削除
```

### 3.2 支払記録の扱い(税法・決済記録)

- PRO: `subscriptions.user_id` をランダムな仮名 `user_erased<32桁16進>` に置き換える。金額・日付・PayPal の ID・返金記録は残す。仮名と元の ID の対応表は作らない。
- RESOLUTE: 注文・付与・更新の課金記録の `user_id` を同じ形の仮名に置換。診断のルール、通知設定、利用権、更新のお知らせ、**PayPal の保管トークン(`renewal_plans`)は削除**。
- 保存期限 `retain_until` = 最後の記録がある年(日本時間)の1月1日 + 8年6か月(= 8年後の7月1日)。課税年度、申告期限(翌年3月15日)、そこから7年を含む。期限後に `purge_expired()` が行ごと消す。
- まだ課金できる契約があると消さない: PRO は `open-contract`、RESOLUTE は `open-renewal` / `open-order`。ジョブは件数だけ記録し、次回に再試行する(PayPal 側の解約・トークン削除は人の作業)。
- RESOLUTE の削除・停止は既存の決まり(`plan_deletions` → `protection_outbox` の削除イベント、`notification_suppressions` → 停止イベント)を通るので、古いバックアップから戻しても診断や通知は復活しない。このトゥームストーンには Clerk ID が残る(§5 の提案 4)。

### 3.3 オーナーアカウント

`OWNER_ACCOUNT_ID` / `PRODUCTION_OWNER_ACCOUNT_ID` は、Webhook、モニター(Python)、両DBの SQL 関数、ジョブの5か所すべてで拒否する。定期削除もオーナーの Push 端末は消さない。各層の ID が `lib/membership/entitlements.ts` と一致することをテストで確認している。このジョブは Clerk のアカウントを削除しない。

### 3.4 期限切れデータの定期削除(OFF)

| 対象 | 期間 |
| --- | --- |
| 無効(`active=0`)のまま90日たった Push 端末と関連行(オーナーを除く) | 90日 |
| 端末がなくなった送信履歴・設定・お知らせ | 即時 |
| テスト通知の重複防止記録 | 1日 |
| 利用者が削除した質問の本文 | 30日 |
| モニターの消去受付記録(件数のみ) | 3年 |
| PRO 課金DB の濫用対策の窓 / 送信済みの警告 | 2日 / 400日 |
| RESOLUTE の送信済み通知 outbox | 90日 |
| 退会者の支払記録(仮名化済み) | `retain_until` まで |

### 3.5 変更したファイル

- `scripts/research/member_data_retention.py`(新規)、`scripts/research/service.py`(3つのルートと定期削除の呼び出し)
- `lib/account/member-erasure.ts`、`app/api/webhooks/clerk/route.ts`(新規)
- `scripts/member-erasure-job.mjs`(新規)
- `db/tech-phase/009_member_erasure.sql`、`db/resolute/026_member_erasure.sql`(新規・未適用)
- テスト: `tests/test_member_data_retention.py`、`tests/member-erasure.test.mjs`、`tests/integration/member-erasure-postgres.mjs`(使い捨てのローカル PostgreSQL 専用。CI には入れていない)

## 4. 保管期間の案(社内ルール)

| データ | 期間 |
| --- | --- |
| アカウント(Clerk) | 退会まで |
| 保存・ノート、ウォッチリスト、リアクション、Push 端末 | 退会まで。無効の端末は90日 |
| 質問 | 退会まで(退会時は本文を消す)。削除した質問の本文は30日 |
| RESOLUTE の診断・通知設定 | 退会まで |
| 支払・購入の記録 | 最後の記録の年の翌年から7年(上の計算で8年後の7月1日まで)。退会時は会員IDを外す |
| 削除・停止の記録(バックアップ対策) | バックアップの最長保管期間が過ぎるまで(提案 4) |
| バックアップ | 最長35日(課金DB 7日+4週)。研究DBは世代数で管理 |
| アプリのログ | 各プラットフォームの既定(Railway / Vercel のプラン設定を確認して記載) |

## 5. ポリシーへの提案(弁護士確認用。法務ページは未変更)

1. §1 取得する情報に追加: 「保存した記事とマーカー・メモ」「リゼルへの質問の内容」「Notesへのリアクション」「価格アラートの設定」。
2. §5 保管期間を表にする(上の §4)。「退会をしたときは、法令で保存が必要なもの(支払・購入の記録)を除き、30日以内に削除します。バックアップに残るものも、その後35日以内に自動で消えます。支払・購入の記録は、法令で定める期間(7年)保存し、退会後はアカウントと結び付けない形で保存します。」(日数はジョブの運用間隔とバックアップ期間に合わせて確定)
3. §2 の「最長●日間」を「最長35日間」に(研究DBのバックアップ世代と外部保管の期間を確認のうえ)。
4. 削除・停止の記録(Clerk ID と時刻のみ)は、バックアップから戻した際に削除を元に戻さないため、バックアップの保管期間が過ぎるまで残す旨を記載するか、ID をハッシュに置き換える設計に変える(別作業)。
5. §9 外部事業者に「ポートフォリオ画像の読み取りや翻訳に、AI の事業者(OpenAI, Anthropic)を使う」「メール配信(Resend)」を追加。
6. 退会の方法(アカウント画面からの削除)と、削除までの流れを記載。

## 6. 本番で有効にする手順(各手順ごとにオーナーの承認が必要)

順番どおりに行う。どれも本番の変更なので、1つずつ承認をもらう。値は表示・記録しない。

1. **PR のマージとデプロイ**(このままでは何も動かない。OFF のまま本番に出す)。
2. **課金DB にマイグレーション適用**: `db/tech-phase/009_member_erasure.sql` を既存のマイグレーション用ロールで本番の課金DB(`tech_phase_billing_live`)に適用。適用前にバックアップが成功していることを確認。
3. **RESOLUTE DB にマイグレーション適用**: `db/resolute/026_member_erasure.sql` を本番 `resolute` DB に適用。
4. **専用ログインの作成**: 課金DB に `tech_phase_member_erasure`、RESOLUTE DB に `resolute_member_erasure`(LOGIN、関数の EXECUTE のみ。テーブル権限なし)。作成後に手順 2・3 のファイルをもう一度流すと GRANT が入る(冪等)。
5. **Clerk の Webhook 登録**: 本番 Clerk インスタンス(プレビュー用ではない)で `https://techphase.app/api/webhooks/clerk` を `user.deleted` だけ購読で登録し、署名シークレットを Vercel 本番の `CLERK_WEBHOOK_SIGNING_SECRET` に設定。
6. **モニター(Railway 本番)の変数**: `MEMBER_ERASURE_ENABLED=true`。再デプロイ。
7. **ウェブ(Vercel 本番)の変数**: `MEMBER_ERASURE_ENABLED=true`。再デプロイ。
8. **ジョブの作成**: Railway に `node scripts/member-erasure-job.mjs` を1日1回動かす cron サービスを作成し、`MEMBER_ERASURE_ENABLED=true`、`RESEARCH_MONITOR_URL`、`RESEARCH_MONITOR_TOKEN`、`MEMBER_ERASURE_BILLING_DATABASE_URL`(手順4のログイン)、`MEMBER_ERASURE_RESOLUTE_DATABASE_URL` を設定。
9. **本番での確認**: テスト用の会員アカウントを本番で作り、Push 登録・保存・お気に入りをしてから Clerk で削除 → Vercel ログに `member-erasure` が出ること、モニター側で件数が出ること、次のジョブ実行で `steps` が増えることを確認(オーナーアカウントでは試さない)。
10. **定期削除を ON**: 確認後、モニターとジョブに `RESEARCH_RETENTION_PURGE_ENABLED=true`。最初の実行の件数をログで確認。
11. **ポリシーの改定**: 弁護士の確認後に §5 の文案を反映(この PR では変更しない)。
12. **(任意)会員画面の削除ボタン**: 上の流れが本番で確認できてから、`/api/research/account/deletion` の `canDelete` を有効化する別作業。Clerk の UserProfile の削除を許可するかどうかも合わせて決める。

## 7. 残っている課題

- HMAC キーは現在の `RESEARCH_MONITOR_TOKEN` で作る。過去にキーを変えていた場合、古いキーで保存された行はこの削除では見つからない(行数の点検が必要)。
- ゲスト購入(`guest_...`)の保存期間と削除は未実装。
- 外部バックアップ(各 R2 バケット)からの削除はバックアップの世代交代に任せる。RESOLUTE のバックアップの保管期間は要確認。
- ブラウザに残るコピー(localStorage など)は、退会後にそのブラウザで開いた場合の消去が未実装。
- 課金DB・RESOLUTE の仮名化後も PayPal 側には取引記録と支払者情報が残る(PayPal の規定)。
