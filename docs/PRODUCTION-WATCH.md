# 本番の毎日点検（production watch, 2026-11-20）

## 何をするか

1日1回、本番（techphase.app）の公開APIと研究モニターの `/health` を、閲覧者のブラウザーと同じ匿名GETで1回ずつ読み、
**ステータスだけでなく中身**を確かめます。読み取りのみで、書き込み・資格情報の送信はしません。

| 名前 | 対象 | 合格条件 | 応答時間の上限 |
|---|---|---|---|
| `homeBand` | `/api/research/company-wire`（ホーム上部のLIVE帯） | `ok`、見出し10件以上・全件にタイトル、最新が12時間以内 | 5秒 |
| `news` | `/api/research/news`（ホームのニュース一覧・FREE表示） | `ok`、1件以上、最新が96時間以内（週末・祝日を考慮） | 5秒 |
| `live` | `/api/research/live`（運営用の取得状況画面） | `mode:"automatic"`、`error`/`diagnosticReason`なし（＝保存済みスナップショットへのフォールバックでない）、資料100件以上、スナップショット生成10分以内、最終巡回10分以内 | 8秒 |
| `freshness` | `/api/research/freshness`（全ページの遅延表示） | `status:"ok"`、最終巡回10分以内 | 8秒 |
| `earningsResults` | `/api/research/earnings-results?month=recent`（カレンダーの決算結果） | `ok`、`complete:true`（保存版から）、1件以上で数値つきが1件以上、最新が30日以内 | 5秒 |
| `compareSearch` | `/api/research/stocks?scope=compare&q=NVDA`（銘柄比較の検索） | `ok`、NVDAが見つかる | 5秒 |
| `monitorHealth` | 研究モニター `https://research-monitor-staging-research-staging.up.railway.app/health` | `ready`、`health.status:"ready"`、`issues`なし、最終巡回10分以内 | 15秒 |

出力は1行のJSONで、真偽値・件数・HTTPステータス・ミリ秒・固定の失敗コード（`timeout` など）だけです。タイトル・URL・数値・環境変数の値は出しません。

```
{"check":"production-watch","ok":false,"failed":["live","freshness"],"checks":{"live":{"status":200,"ms":8596,"fast":false,"valid":false,"automatic":false,"fallback":true,...},...},"generatedAt":"..."}
```

1つでも不合格なら終了コード1で終わり、Railway のcron実行が **failed** と表示されます（それが通知）。

## どう動くか（新しいサービスは不要）

既存の `earnings-selfcheck` cronサービス（Railway、`research-staging` 環境、毎日 `30 22 * * *` UTC = 07:30 JST）の同じコンテナで動きます。
`services/earnings-selfcheck/Dockerfile` の起動コマンドを `scripts/research/daily_checks.py` に変え、これが
決算セルフチェック（`earnings_selfcheck.py`、従来どおりの1行）と本番点検（`production_watch.py`、上の1行）を順に実行します。
片方が例外で止まっても、もう片方は実行されます。どちらかが失敗なら終了コード1です。

- 有効化: サービスにすでにある `EARNINGS_SELFCHECK=true` で本番点検も有効になります。Railway・Vercel の設定変更は不要です。
- 本番点検だけ止める: `PRODUCTION_WATCH=false`（変数の追加は本番設定の変更なので、オーナーの承認が必要）。
- サービスは `codex/research-preview` から自動デプロイされるため、このPRのマージ後の次のビルドから有効になります。
- 手元での実行: `PRODUCTION_WATCH=true python3 scripts/research/production_watch.py`
  （`PRODUCTION_WATCH_SITE_URL` / `PRODUCTION_WATCH_MONITOR_URL` で接続先を変更可）。

## 初回実行（2026-11-20、このPRのコードで手元から）

`live`（保存済みスナップショットへのフォールバック、8.6秒）と `freshness`（8.7秒）が不合格。原因は監視サービスの `/live` 応答が3MBを超え、
組み立てに8〜13秒かかっていたこと。同じPRで `/live` を2.4MB以内に抑え、バックグラウンドで組み立てて即答するよう修正済み（監視サービスの再デプロイ後に解消見込み）。
