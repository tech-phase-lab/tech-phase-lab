# 株価表示の作り替え (TradingView → Twelve Data) 記録

2026-11-10 実装。画像3枚(マーケット / 株価カード2種 / 銘柄の詳細)に合わせた。

## 作ったもの
- サーバー: `lib/research/market-data.ts`(Twelve Data の quote / time_series / statistics / earnings)、純関数 `lib/research/market-quote.ts`。
  API: `/api/research/market/{quotes,chart,indices,facts}`。キーは `TWELVE_DATA_API_KEY`(サーバーだけ)。キャッシュは約1分(日足・週足は5分、EPS等は6時間)。
- 画面: `app/research/price/*`(カード、指数パネル、チャート、詳細)、`/research/quote/[ticker]?from=watchlist|watch|search`。
- ウォッチリスト: 行を押すと詳細ページへ移動(行内展開は廃止)。一覧の見た目は変更なし。株価は `/api/research/market/quotes` から取得して反映(以前は価格を渡す処理が無く「—」のままだった)。
- 監視22銘柄ページ = 値幅ゲージ + 目のボタン(状態はブラウザに保存)。銘柄検索 = 52週ダイヤル。

## 記録(判断したこと)
- 指数: まず DJI / NDX / SPX を試し、契約プランで取れない指数だけ ETF(DIA / QQQ / SPY)で代用する。代用時は列に「DIA（ETF）の値」と出す。値はETF価格になり、騰落率はETFのもの。
- 次回決算: サイトの `calendar.ts` を優先、なければ Twelve Data の earnings。どちらも無ければ「—」。
- 1日=5分足、1週=30分足、1ヵ月〜1年=日足、3年・5年=週足。
- 削除: TradingView の4つのウィジェット(market/{widget,ticker-widget,themes-widget}、stocks/widget)、themes.tsx、index-strip、compact-quote、tradingview-chart。セクター別騰落率とヒートマップは表示しない。
- 詳細ページの企業情報・連関マップは既存の部品(CompanyIntroductionPanel / CompanyNetworkMap)を使用。

## 本番で確認すること(未実施: 本番のキーはサーバー側のみ)
- [ ] MU / SNDK / NVDA / AAOI でカード・詳細ページの全項目
- [ ] 指数3つ(代用の有無)
- [ ] 3年・5年のローソク足
- [ ] 「TradingView」の文字・読み込みが残っていない
