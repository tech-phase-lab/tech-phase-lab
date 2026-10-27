# 財務レーダーの保存先

状態：SQL・専用API準備済み。本番DBには未適用。
経路A（Railway API経由）に決定。接続仕様は FINANCIAL-RADAR-API-HANDOFF.md、
本番手順は FINANCIAL-RADAR-RAILWAY-SETUP.md を参照。
Railwayへの接続・再認証禁止を維持し、本番で作成済みとは扱わない。

- テーブル：`public.tech_phase_financial_radar`
- Railway保存API側だけの環境変数：`TECH_PHASE_RADAR_DATABASE_URL`
- Claude側：`TECH_PHASE_RADAR_API_URL` と保存・読取用トークン（API仕様書参照）
- この環境変数は新規の接続契約名。現時点では未設定。
- 既存のTech Phase PostgreSQL内に追加する。新しいDBは不要。
- SQL：`scripts/tech-phase/financial-radar-schema.sql`

| 保存する値 | 列 | 単位・対応 |
|---|---|---|
| ジャンル | genre | ai-cloud / semis / network / software / power など |
| 銘柄 | ticker | NVDAなど |
| 稼ぐ力 | ocf_margin | facts.latest.ocfMargin、％。マイナスや100超も保存 |
| 守る力 | cover | facts.latest.cover、倍。Infinityは既存表示と同じ1000に変換 |
| 売上前年比 | revenue_growth | facts.latest.revenueGrowth、％。不明はNULL |
| 売上規模 | revenue_usd | facts.latest.revenue、米ドル実額 |
| 決算日 | period_end | facts.latest.end、会計期間末。発表日とは別 |
| 前回の稼ぐ力 | previous_ocf_margin | facts.previous.ocfMargin。不明はNULL |
| 前回の守る力 | previous_cover | facts.previous.cover。不明はNULL |
| 要確認 | needs_review | boolean。既存判定を保存 |
| 計算日時 | calculated_at | タイムゾーン付き日時。計算を開始した時点をUTCで保存 |
| 既存PRO表示の補足 | fcf_margin / basis / previous_period_end | fcfMargin / annualまたはttm / previous.end |

主キーは `(genre, ticker)`。最新結果を1件保存する設計。
別ジャンルの同じ銘柄は別の行になる。順位と点の大きさはジャンル全体から再計算する。
会員テーブルとの外部キー、既存テーブルのALTER、既存権限の変更はない。

## Claude側の接続・保存

`TECH_PHASE_RADAR_DATABASE_URL` はサーバー専用。`NEXT_PUBLIC_`を付けない。
この変数がない場合に会員用・決済用のDB接続変数へフォールバックしない。
接続ユーザーはこのテーブルへのSELECT/INSERT/UPDATEだけを持つ専用ユーザーとする。
DB所有者や既存の会員・決済用ユーザーをアプリの実行用に流用しない。
実際の専用ユーザーと接続文字列の作成・設定は本番適用時に行う。

接続経路は Vercel等のClaudeサーバー → 専用Railway API → 既存PostgreSQL。
Claude側にDB接続情報を設定しない。既存の会員APIには追加しない。

パラメータ化SQLの例（文字列連結で値を埋め込まない）：

```sql
INSERT INTO public.tech_phase_financial_radar
  (genre,ticker,ocf_margin,cover,revenue_growth,revenue_usd,period_end,
   previous_ocf_margin,previous_cover,needs_review,calculated_at,
   fcf_margin,basis,previous_period_end)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
ON CONFLICT (genre,ticker) DO UPDATE SET
  ocf_margin=EXCLUDED.ocf_margin, cover=EXCLUDED.cover,
  revenue_growth=EXCLUDED.revenue_growth, revenue_usd=EXCLUDED.revenue_usd,
  period_end=EXCLUDED.period_end, previous_ocf_margin=EXCLUDED.previous_ocf_margin,
  previous_cover=EXCLUDED.previous_cover, needs_review=EXCLUDED.needs_review,
  calculated_at=EXCLUDED.calculated_at, fcf_margin=EXCLUDED.fcf_margin,
  basis=EXCLUDED.basis, previous_period_end=EXCLUDED.previous_period_end
WHERE EXCLUDED.calculated_at > tech_phase_financial_radar.calculated_at;
```

古い計算が後から完了しても、新しい結果を上書きしない。
取得失敗や計算失敗はゼロの結果として保存せず、前回の正常値を保持する。

## 本番適用

1. Tech Phaseの既存PostgreSQLであることを確認し、DB所有者としてSQLを実行。
2. 専用接続ユーザーを作成し、このテーブルだけにSELECT/INSERT/UPDATEを付与。
3. 接続経路に応じて `TECH_PHASE_RADAR_DATABASE_URL` をサーバー環境に保存。
4. 専用ユーザーで1件保存・更新・読取し、会員テーブルを読めないことも確認。

この文書とSQLの準備だけでは本番テーブル作成・接続設定は完了しない。

## 検証記録（2026-10-28 JST）

SQLの再実行、同一計算の重複保存、新旧結果の競合、NaN/Infinity等の不正値拒否、
既存テーブルのデータ保持、専用テストroleの保存権限と会員テーブルへのアクセス拒否を確認。
これはローカルの検証結果であり、本番のDB名・role・接続経路の確認を代替しない。
