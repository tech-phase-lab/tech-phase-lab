# Claudeへの引き継ぎ：財務レーダー保存API（経路A）

2026-10-28 JST。専用API実装済み。本番DB適用・Railwayサービス作成は未実施。
実URLはRailwayでGenerate Domainを実行してから確定する。未発行のURLを完成扱いしない。

## 接続先と環境変数

| 設定場所 | 名前 | 内容 |
|---|---|---|
| Claude側のサーバー（Vercel Productionなど） | TECH_PHASE_RADAR_API_URL | 発行されたHTTPS URLのorigin。末尾にAPIパスを含めない |
| 両サーバー | TECH_PHASE_RADAR_WRITE_TOKEN | 保存専用の同一秘密値。ランダム32文字以上 |
| 両サーバー | TECH_PHASE_RADAR_READ_TOKEN | 読取専用の同一秘密値。WRITEとは別のランダム32文字以上 |
| Railway専用APIのみ | TECH_PHASE_RADAR_DATABASE_URL | 専用ユーザーtech_phase_radar_writerのDB接続文字列 |
| Railway専用APIのみ | TECH_PHASE_RADAR_DATABASE_NAME | 接続する既存Tech Phase DBの実名 |

秘密値は英数字・ハイフン・アンダースコアのみ。32〜256文字。
NEXT_PUBLICを付けない。ブラウザーにトークンやDB接続先を渡さない。
Claudeのフロントは自サイトのサーバーAPIを呼び、そのサーバーが本APIを呼ぶ。
会員のFREE/PRO判定は既存Claude側サーバーで維持する。本APIは会員を扱わない。
ブラウザーからのOrigin付きリクエストは拒否し、CORS許可ヘッダーは出さない。
URL発行時もAPIの保存・読取にはBearer認証が必須。

## 保存

`POST {TECH_PHASE_RADAR_API_URL}/v1/financial-radar`

- Authorization: Bearer (TECH_PHASE_RADAR_WRITE_TOKENの値)
- Content-Type: application/json
- 1回1銘柄。最大16KiB。以下の全14項目を送る。不明な任意値はNULL。
- calculated_atは計算開始時刻のUTC。5分を超える未来は拒否。

```json
{
  "genre": "ai-cloud",
  "ticker": "NBIS",
  "ocf_margin": -12.5,
  "cover": 2.4,
  "revenue_growth": 40.2,
  "revenue_usd": 1000000000,
  "period_end": "2026-09-30",
  "previous_ocf_margin": -18.1,
  "previous_cover": 2.8,
  "needs_review": false,
  "calculated_at": "2026-10-28T01:00:00Z",
  "fcf_margin": -20.5,
  "basis": "ttm",
  "previous_period_end": "2026-06-30"
}
```

上は形式説明用の架空の数値。実データとして保存しない。
稼ぐ力/FCF/前年比は％、守る力は倍、売上は米ドル実額。
Infinityは既存表示と同じ1000へ変換。NaNは保存しない。
前回ocf_marginとcoverは両方NULLまたは両方数値。
period_endは既存facts.latest.end（決算期末）で、決算発表日時ではない。

成功は200 `{"ok":true,"saved":true}`。
同じ計算日時または古い結果は上書きせず200 `{"ok":true,"saved":false}`。
異なる計算を更新する場合は新しいcalculated_atを使う。
取得失敗をゼロで上書きしない。直近の正常値を維持する。

## 読取

`GET {TECH_PHASE_RADAR_API_URL}/v1/financial-radar?genre=ai-cloud`

Authorization: Bearer (TECH_PHASE_RADAR_READ_TOKENの値)

任意で `&ticker=NBIS` を付ける。ジャンルは必須。最大100銘柄、ticker順。
200 `{"ok":true,"items":[保存した14項目のオブジェクト]}`。未保存はitems=[]。
数値はJSON number、日付はYYYY-MM-DD、計算日時はUTCのISO形式。

## エラーと運用

- 400: 入力不正、401: 秘密値不一致、403: Origin付き、404: パス不正
- 405: メソッド不正、413: 大きすぎる本文/圧縮本文、415: JSON以外
- 503: DBなどの一時障害。上限を設けて再試行。同じ結果の再送は安全。
- `GET /livez` は公開のプロセス生存確認のみ。DB健全性や保存成功の保証ではない。
- 起動時に専用roleとテーブルを確認。管理者接続文字列が残っていると起動拒否。
- ログには固定のエラー種別だけを出し、URL・トークン・SQL例外は出さない。
- 保存処理/SQLは既存ログイン・会員・決済・ニュースのコードをimportしない。
- テーブルは `public.tech_phase_financial_radar`、主キーはgenre,ticker。

## 本番受入（未完了）

専用roleで保存・読取、トークンなし401、READトークンで保存401、
同じ結果の再送saved=false、古い結果による上書き拒否を実URLで確認する。
実データはClaudeの既存計算結果を1件使う。架空の結果で本番銘柄を上書きしない。
本番のテーブル・role・秘密値・URLが揃うまでは、サイト側の保存先を切り替えない。
