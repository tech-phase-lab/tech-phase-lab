# 本番の毎日点検（production watch, 2026-11-20）

## 何をするか

1日1回、本番（techphase.app）の公開APIと研究モニターの `/health` を、閲覧者のブラウザーと同じ匿名GETで1回ずつ読み、
**ステータスだけでなく中身**を確かめます。読み取りのみで、書き込み・資格情報の送信はしません。

| 名前 | 対象 | 合格条件 | 応答時間の上限 |
|---|---|---|---|
| `homeBand` | `/api/research/company-wire`（ホーム上部のLIVE帯） | `ok`、見出し10件以上・全件にタイトル、最新が12時間以内 | 5秒 |
| `news` | `/api/research/news`（ホームのニュース一覧・FREE表示） | `ok`、1件以上、最新が米国の取引日の時間で72時間以内（土日・NYSE休場日は数えない。11/23変更、旧: 96時間） | 5秒 |
| `live` | `/api/research/live`（運営用の取得状況画面） | `mode:"automatic"`、`error`/`diagnosticReason`なし（＝保存済みスナップショットへのフォールバックでない）、資料100件以上、スナップショット生成10分以内、最終巡回10分以内 | 8秒 |
| `freshness` | `/api/research/freshness`（全ページの遅延表示） | `status:"ok"`、最終巡回10分以内 | 8秒 |
| `earningsResults` | `/api/research/earnings-results?month=recent`（カレンダーの決算結果） | `ok`、`complete:true`（保存版から）、1件以上で数値つきが1件以上、最新が30日以内 | 5秒 |
| `compareSearch` | `/api/research/stocks?scope=compare&q=NVDA`（銘柄比較の検索） | `ok`、NVDAが見つかる | 5秒 |
| `monitorHealth` | 研究モニター `https://research-monitor-staging-research-staging.up.railway.app/health` | `ready`、`health.status:"ready"`、`issues`なし、最終巡回10分以内 | 15秒 |

| `proCompare`（11/27追加） | `/api/research/internal/pro-check`（PRO限定の銘柄比較を固定6組 BRK-B/ORCL・NVDA/AMD・JPM/GS・PG/KO・MET/PRU・AAPL/MSFT で実行） | 全12社が `ready`、7項目（財務・収益性・割安性・安定性・株価モメンタム・成長性・資金創出）がすべて揃い、不正な数値（NaN・無限大・利益率±100%超・負の負債や現金・0以下の売上・0〜10外のスコアなど）がない | 60秒 |

`proCompare` だけは匿名ではありません。監視サービスが比較のバックグラウンド更新にすでに送っている `COMPARISON_WARM_SECRET` を
`Authorization: Bearer` で、サイトのホストにだけ（https）送ります。サイト側のルートはこの値と定数時間で照合し、違えば・無ければ・ブラウザーからの
リクエスト（Origin / Sec-Fetch ヘッダーあり）なら中身のない404を返します。CORSヘッダーなし、会員情報は読まず返しません。比較は会員の比較と同じ
共有ストアから組み立て（リクエストからデータ提供元は呼びません）、割安性の未取得分を監視に依頼することもしません（読み取りのみ）。
**実際に毎日動かすのは研究モニター自身です**（11/27、HQ）。モニターはすでに `COMPARISON_WARM_URL` と `COMPARISON_WARM_SECRET` を持ち、
毎分サイトを呼んでいるので、起動5分後に1回、その後は1日1回（不合格のときは3時間後に再実行）、`COMPARISON_WARM_URL` のホストにだけこの点検を送ります。
ログには同じ2行（`"source":"monitor"` つき）が出て、不合格なら運用インシデント `cron:pro-compare`（`cron_report.record`、critical）を開き、
既存の障害通知でオーナーに「🚨 PRO銘柄比較の点検で異常を検知しました」（不合格の項目: `NVDA-missing`、`AMD-invalid`、`pairs` など）を1回、合格に戻ったとき1回送ります。
変数の追加は不要です。earnings-selfcheck 側には `COMPARISON_WARM_SECRET` が無いため、そちらでは `"proCompare":{"ok":true,"skipped":"no-token"}` と出て、不合格にはしません。
会社ごとの詳細は2行目 `{"check":"pro-compare","ok":...,"companies":{"NVDA":{"missing":[],"invalid":[],"strengths":3,"weaknesses":1},...}}`
（項目名・フィールド名・件数のみ）。長所・短所の文言そのものはルートの応答で確認できます。

出力は1行のJSONで、真偽値・件数・HTTPステータス・ミリ秒・固定の失敗コード（`timeout` など）だけです。タイトル・URL・数値・環境変数の値は出しません。

```
{"check":"production-watch","ok":false,"failed":["live","freshness"],"checks":{"live":{"status":200,"ms":8596,"fast":false,"valid":false,"automatic":false,"fallback":true,...},...},"generatedAt":"..."}
```

1つでも不合格なら、毎日のcron（`daily_checks.py`）は結果を監視サービスの障害通知に送り（`cron_report.py`、下の「通知」）、終了コード0で終わります（11/23変更。以前は終了コード1でRailwayの「deployment crashed」メールが通知代わりでした）。

## どう動くか（新しいサービスは不要）

既存の `earnings-selfcheck` cronサービス（Railway、`research-staging` 環境、毎日 `30 22 * * *` UTC = 07:30 JST）の同じコンテナで動きます。
`services/earnings-selfcheck/Dockerfile` の起動コマンドを `scripts/research/daily_checks.py` に変え、これが
決算セルフチェック（`earnings_selfcheck.py`、従来どおりの1行）と本番点検（`production_watch.py`、上の1行）を順に実行します。
片方が例外で止まっても、もう片方は実行されます。

## 通知（11/23から）

不合格は監視サービスの `POST /internal/cron-report` に送られ、障害（`cron:production-watch` / `cron:earnings-selfcheck`、critical）として
記録されます。オーナーへの通知は既存の障害通知（Web Push またはwebhook）で、開いたとき1回・合格に戻ったとき1回です。

- 必要な変数（本番設定の変更なのでオーナーの承認が必要）: 監視サービスに `RESEARCH_CRON_REPORT_TOKEN`（32文字以上）、
  earnings-selfcheck に同じ値の `RESEARCH_CRON_REPORT_TOKEN` と `RESEARCH_CRON_REPORT_URL`（監視サービスの https のベースURL）。
- 終了コード1になるのは、点検自体が動けなかったとき（例外）か、不合格を通知に送れなかったとき（変数が未設定・監視に届かない）だけ。
  変数が入るまでは、不合格の日は従来どおり終了コード1（メール）になり、黙って消えることはありません。

- 有効化: サービスにすでにある `EARNINGS_SELFCHECK=true` で本番点検も有効になります。Railway・Vercel の設定変更は不要です。
- 本番点検だけ止める: `PRODUCTION_WATCH=false`（変数の追加は本番設定の変更なので、オーナーの承認が必要）。
- サービスは `codex/research-preview` から自動デプロイされるため、このPRのマージ後の次のビルドから有効になります。
- 手元での実行: `PRODUCTION_WATCH=true python3 scripts/research/production_watch.py`
  （`PRODUCTION_WATCH_SITE_URL` / `PRODUCTION_WATCH_MONITOR_URL` で接続先を変更可）。

## 初回実行（2026-11-20、このPRのコードで手元から）

`live`（保存済みスナップショットへのフォールバック、8.6秒）と `freshness`（8.7秒）が不合格。原因は監視サービスの `/live` 応答が3MBを超え、
組み立てに8〜13秒かかっていたこと。同じPRで `/live` を2.4MB以内に抑え、バックグラウンドで組み立てて即答するよう修正済み（監視サービスの再デプロイ後に解消見込み）。
