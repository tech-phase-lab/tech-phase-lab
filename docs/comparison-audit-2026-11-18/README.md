# 銘柄比較PRO 全銘柄監査（2026-11-18）

対象: SEC の会社一覧（/api/research/stocks が検索する全 10,400 ティッカー。上場 7,667・OTC 等 2,733）。
方法: `scripts/research/comparison-audit/audit.mjs` が比較 API と同じサーバーコード（lib/research/comparison-server.ts）を通して各ティッカーを評価。
SEC はディスクキャッシュ付き・毎秒 8 件以下。Twelve Data は参照リスト（/stocks 1 回）だけを使い、掲載銘柄には合成の直近株価系列を渡す
（予想PER＝statistics と提供元の決算書は監査外。本番ではバックグラウンド保存分で割安性・財務健全性がさらに埋まる）。

- full: 割安性以外の 6 項目をすべて採点
- partial: 3 項目以上を採点（総合評価が出せる）
- failing: 採点 2 項目以下

全件の表: `audit.csv`（before / after / cause_after / missing_after）。

| group | | full | partial | failing | total |
|---|---|---|---|---|---|
| listed | before | 2352 | 1329 | 3986 | 7667 |
| listed | after | 2518 | 2737 | 2412 | 7667 |
| otc | before | 178 | 332 | 2223 | 2733 |
| otc | after | 189 | 616 | 1928 | 2733 |
| all | before | 2530 | 1661 | 6209 | 10400 |
| all | after | 2707 | 3353 | 4340 | 10400 |

移動: failing→partial 1,744、failing→full 125、partial→full 52、悪化 0。

## 修正後も failing の主な理由（上場 2,412 件）

業種別: SPAC 807、ファンド/ETF/商品信託 552、医薬・バイオ（売上なし）388、銀行・金融（IFRS 銀行など）234、その他 431。

- 1,549 標準の売上タグなし（US GAAP）: SPAC、ETF・商品信託（GLD など）、臨床段階バイオ、mREIT
- 337 最新の四半期提出書類から数値を取得できない: 主に優先株・ワラント等の別ティッカー、XBRL の矛盾
- 161 SEC の XBRL 財務データなし: 投資信託・新規上場など
- 102 売上を特定できない（タグ矛盾）
- 71 標準の売上タグなし（IFRS）: HSBC・BBVA など IFRS の銀行
- 約 130 最新期間が古い: カナダの銀行（40-F、四半期 6-K 未タグ）、提出停止企業など

OTC（2,733 件）の failing 1,928 件のうち 1,112 件は SEC に財務データがない外国株 ADR です。
