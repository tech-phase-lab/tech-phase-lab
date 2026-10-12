# RESOLUTE ②〜④の接続（2026-10-12）

## 今回の範囲

Claudeの `resolute-logic(1).zip`（SHA-256 `a283e2798f2913d6ce9e7b93c5aba534550dbb59dc9a229f0b87f347298d7e8b`）内の4画面を参考に、日英の②シミュレーション・③アラート・④翌朝と共通メニューを組み込んだ。①の承認済み締めと英語修正は維持。HTMLの架空の銘柄・金額を購入者のデータとして初期入力しない。

- `/resolute`：① 診断
- `/resolute/simulation`：② シミュレーション。保存計画の生活費・許容額・1銘柄上限・買い増しラインを読み込む。保有額と、うち1銘柄の額はともに0。下落／上昇タブ、割合のボタン、到達ライン、ルール欄を表示。ルール欄の変更は画面内の試算用で、計画に保存しない。上昇試算は1銘柄のみ上がり、残りが横ばいの前提を明記する。
- `/resolute/alerts`：③ 銘柄と米ドル建て基準価格、保存済みの下落ライン、任意の上昇目安、届く時刻、受信設定、実送信しないメール例。
- `/resolute/morning`：④ 初期オフの受信設定、③と共通の時刻、3択の見直し例。選択した気持ちは保存・ログ出力・メール添付しない。

## 通知設定API

ブラウザは同一originの `GET /api/resolute/notification-settings` と `PUT /api/resolute/notification-settings` を使用。Vercelから既存の認証方式でRailwayの `/internal/v1/notification-settings` へ転送する。Railway URLやサービス間キーをクライアントへ渡さない。本人IDは検証済みClerk JWTのsubのみ。

応答は `{ settings, revision }`。未保存時は下記の初期値とrevision=0。PUTは `{ settings, baseRevision }`、成功でrevision+1、不一致409は最新の応答。③と④は同じレコードを使う。競合・応答不明の保存を自動再送せず、明示的な再読込を要求する。

```ts
type NotificationSettings = {
  deliveryHourJst: 7 | 8 | 9 | 10; // 初期7。固定Asia/Tokyo
  alertsEnabled: boolean;         // 初期false。本人が受信を選び保存する
  morningEnabled: boolean;        // 初期false
  watchItems: { symbol: string; referencePrice: number }[]; // 初期[]、最大5
  surgeCapPct: number | null;     // 初期null
};
```

基準価格はUSDの単価（0.01〜1,000,000、小数2桁まで）。PlanのUSD金額がセント整数である仕様とは別。symbolは英大文字から始まる英数字・ピリオド・ハイフンの最大15文字、重複不可。上昇目安は0.1〜1,000%、小数1桁。メールアドレス、自由記述、本人ID、任意の追加キーは受け付けない。下落率は計画のbuyLinesから読むため設定に重複保存しない。再通知設定は従来のfalseを維持し、未確定の選択項目を新設しない。

設定のGET/PUTにはuse activeが必要。通知期間終了だけで設定を消去しない。PROは判定に使わない。実配信ではuseとalertsの両方、本人の受信設定、確認済み宛先、配信停止、保存済み言語を確認する。一般会員の言語・timezone APIは変更しない。時刻は英語表示でも日本時間で、会員timezoneや米国夏時間によって変換し直さない。

401認証、403利用不可、400不正入力、409競合、413上限超過、415JSON以外、429制限、503未設定／障害。本文上限8KiB、private/no-store。例外本文・入力内容・接続情報を応答やログに出さない。

## DBと未有効化のゲート

`004_notification_settings.sql` と `005_notification_outbox.sql` を追加。001〜003に続き、専用DB `resolute` へ明示適用するためのファイルで、自動実行しない。既存DBの適用済みmigrationを書き換えない。

設定保存は専用 `resolute_notification_writer`。USAGE、entitlementsのSELECT、notification_settingsのSELECT/INSERT/UPDATEだけを付与する設計。既存readerやplan writerの権限を広げない。

本番で必要になる変数名は `RESOLUTE_NOTIFICATION_DB_URL` と `RESOLUTE_NOTIFICATION_API_ENABLED`。値は今回設定していない。有効化されていなければAPIは503。画面は保存成功と表示せず「メール配信は準備中です」と表示する。本番の計画保存APIの既存ゲートも維持する。

今回、実DBの002〜005、writer role、独立削除履歴／復元接続を適用・完成していない。新しい通知設定・outboxを含む実バックアップ／復元、設定を消した後の復元抑止、配信停止の復元時の優先適用も、本番開始前の確認対象。既存のバックアップ成功を、今回追加したテーブルの復元確認と扱わない。

## 指定時刻の通知候補作成

`alert-judge.ts` は添付と同一内容。isFinal=false/no_closeは送らず、通知状態を進めず、次の本人指定時刻に提供元の確定終値で判定し直す。日付や経過時間だけで確定済みに変えない。営業日・休場日・最新の市場日付は価格提供元のアダプターが供給し、ジョブが想像で補完しない。

`notification-job.ts` と `notification-outbox.ts` は、UTC cron `0 0,1,22,23 * * *`（日本時間7/8/9/10時）を想定。各回は自分のdeliveryHourJstに一致する人だけを処理する。同じ時間帯の再実行は一意キーで重複を防ぎ、別の時間帯へ勝手に繰り越さない。時計の基準は処理時刻。前日の22/23 UTCが日本時間翌朝7/8時になる点をテストする。

ユーザー単位のDBロックで設定変更・権限変更・候補作成を直列化する。通知候補のdurable outbox挿入とjudgeのnextState保存を同一トランザクションで行う。新規queuedのときだけ状態を進める。duplicateや失敗では新しいラインを通知済みにしない。1人1日本日付1通の③と、最大1通の④をそれぞれ一意制約で保証する。メール本文へ渡すのは銘柄・価格・ラインのみで、answersや自由記述を渡さない。

④は直前の③についてメール送信サービスの受付が確認されたaccepted_atの日本日付を基準に、翌日の同じ設定時刻に1通。outboxに入っただけ、未確定データだけ、アラート非該当の日は翌朝メールを作らない。毎朝の定期メールではない。時刻を変更した場合は、その時点の共通設定に従う。設定オフや通知利用権の終了で止める。

`notification-dispatch.ts` は送信直前の再確認用。配信有効化フラグ、現在の利用権・通知利用権、受信設定、確認済み宛先、配信停止、設定revision、ルール識別値、本人指定の日本日付／時刻を再確認する。古い設定で作られた候補は送らない。送信サービス側にも同じ冪等キーを渡し、応答不明を自動再送しない。確認済み受付だけをacknowledgeし、duplicateを新規受付として扱わない。

未接続：価格提供元、Clerk宛先解決、実メール事業者、配信停止の署名リンク、outbox送信と受付照合の実アダプター、設定変更で抑止した候補の再調整、Cron起動・失敗監視。outboxへ記録できることは、受信者へメールが届いたことを意味しない。これらを確認するまで実配信を有効化しない。

## 費用・送信・文言

新しいRailwayサービス、Cron、Bucket、プラン、請求設定は作成・変更していない。追加課金を伴う構成変更と実メール送信はしていない。既存RESOLUTE専用API／DBで動かす想定だが、価格・メール提供元と稼働量を接続前に確認し、追加費用が承認範囲を超える見込みなら相談する。ニュース監視・他DBに変更しない。

添付mail-templates.tsは日英とも下書きのまま保持。④の「昨夜のお知らせ」「last night's alert」は、③が朝に届く仕様と一致しない。送信前に「昨日のお知らせ」「yesterday's alert」等への文言変更をオーナーに確認する。画面のメール例も下書きと明示し、送信しない。添付の税金計算は今回対象外。


検証結果：Node 781/781、Python 2,406/2,406（131.439秒、RESEARCH_TEST_NOW=2026-10-08T06:00:30+00:00）、lint 0 errors（既存warnings 2件）、Next.js build、compileall、git diff --check成功。添付のalert-judge/mail-templatesもテストへ組み込み、元ファイルとの一致を確認。隔離PostgreSQLで通知設定の保存・再読込・別人拒否・更新競合・限定writerの権限、outboxの重複時に未送信ラインを既通知にしないこと、確定前の除外、受付確認済み③だけを起点にする④を確認。送信直前の権限・時刻・設定変更・配信停止・宛先確認も純粋なテストで確認した。

Chromiumの390px幅で日英の③→④→②→③を操作し、9時設定の保存/読戻し、④初期オフとオン保存、②保有額0と保存計画の初期値、横はみ出しなし、409で上書きしないことを確認。ブラウザ側のAPI応答はテスト用に差し替えた。実Clerk/Railway/本番DBの保存や実メール到達を確認した結果ではない。基準ブランチは別担当更新を含むe7666dc。
