# AI関連20銘柄：取得確認の記録

2026-09-19の手動実行結果。常時監視の稼働状況ではありません。対象ページ・RSSに掲載された範囲の取得です。

| 銘柄 | 会社 | 形式 | 一覧の取得 | 登録資料 | 取得成功 | 取得エラー |
| --- | --- | --- | --- | ---: | ---: | ---: |
| MU | Micron | html | 成功 | 12 | 0 | 2 |
| NBIS | Nebius | html | 成功 | 24 | 5 | 0 |
| NVDA | NVIDIA | rss | 成功 | 20 | 1 | 0 |
| AMD | AMD | rss | 成功 | 10 | 1 | 0 |
| AVGO | Broadcom | html | 成功 | 46 | 1 | 0 |
| ARM | Arm | rss | 成功 | 6 | 1 | 0 |
| TSM | TSMC | html | http-403 | 0 | 0 | 0 |
| ASML | ASML | html | 成功 | 3 | 1 | 0 |
| MRVL | Marvell | html | 成功 | 6 | 1 | 0 |
| ANET | Arista Networks | html | http-403 | 0 | 0 | 0 |
| CRDO | Credo | html | 成功 | 6 | 0 | 1 |
| CRWV | CoreWeave | html | 成功 | 4 | 1 | 0 |
| VRT | Vertiv | html | no-links | 0 | 0 | 0 |
| GEV | GE Vernova | rss | 成功 | 20 | 1 | 0 |
| DELL | Dell Technologies | html | 成功 | 10 | 1 | 0 |
| PLTR | Palantir | html | no-links | 0 | 0 | 0 |
| MSFT | Microsoft | rss | 成功 | 6 | 1 | 0 |
| AMZN | Amazon | rss | 成功 | 10 | 1 | 0 |
| GOOGL | Alphabet / Google | rss | 成功 | 7 | 1 | 0 |
| ORCL | Oracle | html | timeout | 0 | 0 | 0 |

TSM・ANETはHTTP 403、VRT・PLTRは設定した方法で発表リンクを抽出できず、ORCLはタイムアウトです。MU・CRDOは一覧取得に成功していますが、試した本文の取得に失敗しています。

新しい13社は一覧に含まれる記事のうち1件ずつを試しました。うち12社で応答取得に成功し、CRDOは403でした。すべての記事の取得成功・正確性・鮮度を確認したものではありません。発表日が未照合の資料は未確認のまま保持しています。

新たに導入した仕組みは公式RSS / Atomの読み取り、企業ごとの取得設定、分野別表示です。新しい有料APIやプラグインの契約・接続は行っていません。
