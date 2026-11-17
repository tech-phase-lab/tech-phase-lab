# RESOLUTE ③アラート・④翌朝のお知らせを「スマホ通知」で届ける（2026-11-17）

オーナー指示（screens/01_push_*・02_alert_page_*）の実装。届く時刻・判定の条件・文の方針（売買を指示しない、将来を断定しない）は変えていない。

## 1. 仕組み（受け渡しの設計）

```
resolute-notifications（cron, UTC 0 0,1,22,23）
  ① notification-queue.mjs … これまでどおり outbox に候補を作る（変更なし）
  ② mail-worker.mjs … これまでどおり1件ずつ「送信直前の再確認」（RESOLUTEのDB：use+alerts 利用権・受信設定・確認済み宛先・配信停止・設定revision）
       └ 送る手段（provider "resend"）の中で、まずスマホ通知を試す（lib/resolute/notification-push.ts withPushFirst）
            POST {RESOLUTE_PUSH_MONITOR_URL}/internal/resolute/push   Authorization: Bearer RESOLUTE_PUSH_TOKEN
            本文: memberId・event（outboxキーのSHA-256先頭32桁。キーそのものやメールアドレスは送らない）・title「RESOLUTE」・1行の本文・開く画面
       ├ 1台でも受け付けられた → それを受付の証拠（messageId "web-push:<台数>"）として outbox を accepted にする。メールは送らない
       └ 登録された端末がない／全部の端末で失敗／monitor に届かない → これまでのメール（Resend）を送る
research monitor（scripts/research/service.py → web_push.resolute_push）
       専用トークンのみ受け付け、その会員の端末のうち「RESOLUTEの切替がオン」かつ「RESOLUTEの利用権をサイトのサーバーが確認済み（resolute_until）」
       またはオーナーのアカウントの端末だけに送る。端末ごとに1回（push_deliveries に先に記録、あいまいな失敗は再送しない）
```

- 選んだ理由：送る相手と時刻の判断は、すでに監査済みの RESOLUTE の送信処理（outbox・予約・受付照合・再確認）にそのまま残し、monitor は「この会員の端末へこの1行を送る」だけを担う。新しいキュー・新しいサービス・新しいcronは作らない。
- 同じ provider 名（resend）のままなので、outbox の予約・照合・mail-worker のSQLは変えていない。照合（reconcile）では、まず monitor に「この通知を受け付けた端末があるか」（mode lookup）を聞き、なければ Resend に聞く。
- 翌朝（④）は、これまでどおり「受け付けが確認された③」の翌日に1通。③がスマホ通知で受け付けられた場合も同じ。
- おやすみモードは RESOLUTE の通知には効かない（会員が自分で届く時刻 7〜10時を選んでいるため）。
- 環境変数（下の2つ）が無いときは、これまでどおりメールだけ。

## 2. 誰に届くか（Tech Phase PRO とは別）

| 会員 | この端末の通知をオンにできるか | 届くもの |
|---|---|---|
| FREE ＋ RESOLUTE（use と alerts が有効） | できる | RESOLUTE の③④だけ。目標株価・決算・ニュース等は、各送信の直前の PRO 確認（member_expiry）で必ず除外 |
| PRO（RESOLUTE なし） | できる | PRO の通知だけ。RESOLUTE の通知は届かない（RESOLUTE のDBに利用権がなく候補も作られない。monitor 側も resolute_until が無い端末には送らない） |
| PRO ＋ RESOLUTE | できる | 両方。通知設定ページに「RESOLUTE（暴落アラート）」の行（初期オン） |
| オーナー（OWNER_ACCOUNT_ID / PRODUCTION_OWNER_ACCOUNT_ID） | すべての環境でできる | 両方（monitor でもオーナーの端末は RESOLUTE の確認を省略） |
| FREE（RESOLUTE なし） | できない（これまでどおり「スマホ通知はPRO会員向けです」） | なし |

- RESOLUTE の利用権は、Vercel の `/api/research/notifications` がその人のセッションで RESOLUTE API（`getResoluteEntitlementsForSession`）に聞いて決める。ブラウザから来た値は使わない。結果（alerts の期限、なしなら0、確認できなければ送らない）を monitor の端末記録 `resolute_until` に保存する（登録・状態確認・設定の読み書きのたびに更新）。
- RESOLUTE の確認に失敗したとき：PRO なら PRO として続行（RESOLUTE の値は更新しない）、PRO でなければ 503（推測しない）。
- PRO でない会員は、通知設定の保存で `resolute` 以外を変えられない（Vercel と monitor の両方で拒否）。

## 3. 文と開く画面

- 文：`lib/resolute/push-notice.ts`（表のとおり。上昇だけが2銘柄以上の場面は表に無いため「NVDA ほか1銘柄が決めておいた上昇の目安に届きました」/ "NVDA and 1 more reached the rise alert levels you set" とした）。言語は、メールと同じ「保存済みの言語」（Clerk の設定）。
- ③を押す → `/resolute/alerts/latest`「今日のお知らせ」。中身はアラートメール本文と同じ（見出し・日付・「あなたの計画では…」・銘柄カード・確認の一文・「計画を開く」「今夜のひと息」・「情報の提供であり、投資助言ではありません。」）。データは resolute-api の `GET /internal/v1/latest-alert`（本人の、受け付け済みの最新の③1件だけ）。
- ④を押す → `/resolute/morning`（いまの3択の画面）。
- 2つの画面は `lib/research/push-targets.json` と `public/research-sw.js` の一覧に追加（VERSION `2026-11-17-resolute`）。サービスワーカーは /resolute の窓も同じアプリの窓として扱う。iOS の「最近の通知」（push-server-notice.ts）も同じ一覧なので、この2画面へ移動する。
- ホーム画面のアプリ内で開くことは、manifest の scope を "/" にする修正（PR #665）と合わせて確認が必要。

## 4. 画面

- ③④の画面に「この端末で受け取る」（Tech Phase の通知設定と同じ部品 `NotificationSettings`、`scope="resolute"`）。
- Tech Phase の通知設定ページ：RESOLUTE を買った人だけ「RESOLUTE（暴落アラート）」の行（初期オン）。PRO でない RESOLUTE 購入者には、この行（とテスト通知）だけを表示。
- 文言の直し（日英）：③④画面・今夜のひと息・LP・診断・RESOLUTE設定画面・オーナー確認画面の注記・利用規約／プライバシー（`content/legal/*.md` → `node scripts/legal-sync.mjs`）。補足「スマホ通知をオンにしていない場合はメールで届きます」は③画面の1か所だけ。「届く通知の例」は通知の形と「今日のお知らせ」画面（LP の例も同じ）。
- 特定商取引法に基づく表記のページ（/resolute/legal/commerce）はこのリポジトリに無いため、直していない。

## 5. 本番で必要な作業（各回オーナー承認。値は書かない）

| サービス | デプロイ | 変数（名前のみ） | その他 |
|---|---|---|---|
| research monitor（Dockerfile.research-monitor、Vercel の RESEARCH_MONITOR_URL の向き先） | 要（web_push.py・service.py） | `RESOLUTE_PUSH_TOKEN`（新規。32文字以上、ほかのトークンと別の値） | 端末表に列 `resolute`・`resolute_until` を起動時に自動追加（既存の行は resolute=1, resolute_until=NULL） |
| resolute-notifications（cron） | 要（lib/resolute の新ファイル） | `RESOLUTE_PUSH_MONITOR_URL`（monitor の https の origin）、`RESOLUTE_PUSH_TOKEN`（monitor と同じ値） | 配信フラグ（`RESOLUTE_MAIL_DELIVERY_ENABLED` 等）は従来の手順書どおり。2つの変数が無ければメールだけ |
| resolute-api | 要（`/internal/v1/latest-alert`） | なし（既存の `RESOLUTE_NOTIFICATION_API_ENABLED` / `RESOLUTE_NOTIFICATION_DB_URL` を使う） | DB：`db/resolute/024_latest_alert_reader.sql` を適用（`resolute_notification_writer` に notification_outbox の SELECT。DB書き込みのため承認） |
| Vercel（techphase.app） | 要（マージ後） | なし | — |

## 6. オーナーに確認してほしいこと

1. RESOLUTE を買った FREE 会員のテストアカウントで、iPhone のホーム画面の Tech Phase から③または④の画面の「この端末で受け取る」でオン → 通知設定ページに「RESOLUTE（暴落アラート）」の行だけが出ること。
2. 手順書（RESOLUTE-DELIVERY-RUNBOOK）C のオーナー宛テストを、上の変数を入れた状態で1回 → スマホに「RESOLUTE」の通知が届き、押すと「今日のお知らせ」がアドレスバーなしで開くこと、メールは届かないこと。
3. 通知をオンにしていないアカウントにはメールが届くこと（outbox の receipt.messageId が "web-push:" でなく Resend の ID）。
4. 日本語・英語の両方（言語はアカウントの保存済みの言語）。
