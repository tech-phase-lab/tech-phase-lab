# FREE英語版の訂正(2026-11-05)

ChatGPTのレビュー(`TechPhase_FREE_English_Review`、194件)のうち、実装した内容と、していない内容の記録。

## 実装した置き換え: 121件
ソース内の英文が逐語で一致したものを、提案どおりに置き換えた(日本語の文字列は変更していない)。ID: EN-002, EN-003, EN-004, EN-006, EN-007, EN-008, EN-009, EN-010, EN-012, EN-013, EN-014, EN-017, EN-018, EN-019, EN-020, EN-021, EN-022, EN-023, EN-024, EN-025, EN-026, EN-027, EN-028, EN-029, EN-030, EN-032, EN-033, EN-034, EN-035, EN-036, EN-042, EN-043, EN-044, EN-045, EN-048, EN-049, EN-050, EN-051, EN-052, EN-053, EN-054, EN-055, EN-056, EN-057, EN-058, EN-059, EN-060, EN-061, EN-062, EN-063, EN-064, EN-065, EN-066, EN-067, EN-069, EN-070, EN-071, EN-074, EN-075, EN-077, EN-079, EN-081, EN-083, EN-084, EN-085, EN-086, EN-087, EN-096, EN-097, EN-099, EN-101, EN-104, EN-105, EN-106, EN-109, EN-110, EN-111, EN-112, EN-113, EN-114, EN-115, EN-116, EN-117, EN-118, EN-119, EN-120, EN-121, EN-122, EN-123, EN-124, EN-125, EN-127, EN-128, EN-129, EN-130, EN-131, EN-132, EN-133, EN-135, EN-136, EN-138, EN-139, EN-140, EN-141, EN-143, EN-145, EN-146, EN-147, EN-149, EN-150, EN-151, EN-152, EN-153, EN-154, EN-155, EN-156, EN-157, EN-158, EN-159, EN-162, EN-163

## 保留にした置き換え(判断が要る)
- EN-016: 「Alerts」→「Tech news」。メニューなどの共通ラベルで、機能名「Tech Alerts」を固定名とするかの判断が先。
- EN-089/EN-090: 数値入りの見本文。指標の定義の確認が要る。
- EN-178: 日本語の文が元で、順位除外のしきい値の説明。

## 日本語の文が元で、英語を足す必要がある項目(置き換えではなく、英語の翻訳キーの追加が要る)
- EN-160: 財務レーダー → Financial Radar
- EN-161: 稼ぐ力と守る力を、ジャンルごとに1枚で見比べます。点線は前の決算からの動きです。 → Compare companies' cash generation and financial resilience by category. Dotted 
- EN-165: ↑ 守る力 ｜ 現金÷(借入+リース) → ↑ Financial resilience · Cash ÷ (debt + lease liabilities)
- EN-166: 稼ぐ力 ｜ 売上に対する営業キャッシュフロー → → Cash generation · Operating cash flow ÷ revenue →
- EN-167: 横軸が稼ぐ力、縦軸が守る力の散布図 → Scatter plot of cash generation on the horizontal axis and financial resilience 
- EN-169: 盤石 → Strong cash position and cash generation
- EN-170: 余力が小さい → Limited cash cushion and cash generation
- EN-171: 借入で攻める → Strong cash generation, more debt
- EN-172: 売上が前年より増加 → Revenue up year over year
- EN-173: 減少 → Revenue down year over year
- EN-174: 大きさ=売上規模 → Bubble size = revenue
- EN-175: 白抜き=売上の比較なし → Hollow bubble = no year-over-year revenue comparison
- EN-176: PRO限定 → Available with PRO
- EN-177: 数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。 → Figures are calculated from SEC filings. Values outside the chart's range appear
- EN-181: ひとりごと・リゼルに聞く・週刊PRO → Rizel's Notes, Ask Rizel, and PRO Weekly
- EN-182: リアルタイムで流れる速報 → Follow the latest updates in real time.
- EN-183: 22銘柄の動きと、決算後のまとめを確認 → Follow 22 stocks and catch up on their earnings.
- EN-184: 22銘柄の動きを、まとめて確認できます。決算が出たあとのまとめも読めます。 → Follow all 22 stocks in one place, with summaries after each earnings release.
- EN-185: 銘柄を探しにいく手間がなくなります。 → Spend less time searching for updates.
- EN-186: いま強いジャンルをひと目で → See which themes are leading at a glance.
- EN-187: 気になる銘柄を並べて見比べる → Compare the stocks you're interested in side by side.
- EN-188: 決算・経済指標・監視株ニュースを通知 → Get notifications for earnings, economic releases, and news about the stocks we 
- EN-189: 銘柄検索から開ける企業のつながり → Explore company relationships from Stock Search.
- EN-190: 週刊 Tech Phase PRO → PRO Weekly
- EN-191: 読み込み中… → Loading…

(PRO機能体験の説明の英語は、設定ファイル `lib/research/pro-experience.json` の英語欄に入れた。)

## ソースに逐語の一致がなかった置き換え(複数の文を連結した表示、動的な文など)
- EN-001: Read US stocks one move ahead. → Stay ahead of what's happening in U.S. stocks.
- EN-031: 30 min behind · latest 5 → 30-minute delay · latest 5 updates
- EN-038: the same figure from 20 outlets → the same figure reported by 20 sources
- EN-039: the same figure from 11 outlets → the same figure reported by 11 sources
- EN-040: Adjusted Gross margin → Adjusted gross margin
- EN-046: 29holdings → 29 holdings
- EN-047: 441stocks → 441 stocks
- EN-072: Source of memory purchased for AI → Supplies memory for AI systems
- EN-073: Contract chip manufacturer and source of memory purchased → Provides chip manufacturing and memory
- EN-076: No relationships three or more steps from NVDA have been confirmed in  → No connections three or more steps away from NVDA have been confirmed in officia
- EN-082: 22 research companies → 22 stocks we track
- EN-088: Sign in / View your plan → → Sign in or view your plan →
- EN-091: Net loss, continuing operations → Net loss from continuing operations
- EN-092: GAAP · Q2 actual → GAAP · Q2 reported result
- EN-093: Q2 actual · non-GAAP → Q2 reported result · non-GAAP
- EN-094: Q2 actual → Q2 reported result
- EN-095: Prior-year quarter → Same quarter last year
- EN-098: Add the stocks you follow and prices and daily change will line up her → Add stocks to see their prices and daily changes here.
- EN-102: Company → → Company overview →
- EN-107: Get a phone notice on Sunday night when this week's recap is ready → Get a notification on Sunday night when your weekly recap is ready.
- EN-108: The company will start the new fab early next quarter, aiming to raise → The company plans to open its new chip factory early next quarter to increase ca
- EN-134: We cover US high-tech stocks broadly. For the companies we follow most → We cover a wide range of U.S. tech stocks. For the companies we follow most clos
- EN-142: 22 monitored and 28 tracked, 50 in all → Earnings updates for 50 companies, including the 22 stocks we track closely
- EN-144: Only the stocks you pick of the 22 monitored → Choose from the 22 stocks we track.
- EN-164: 8 tickers → 8 stocks

## 確認が必要とされた項目(未実装)
review_before_applying の18件(EN-005, 011, 015, 037, 068, 078, 080, 100, 103, 126, 137, 148, 168, 179, 180, 192, 193, 194)。仕様・ブランド・指標定義の確認が要る。

## 単語の置き換えでは直らない項目(localization_gaps.json)
GAP-01 財務レーダー(英語表示でも日本語)、GAP-02 PRO紹介詳細、GAP-03 週刊PRO、GAP-04/05 利用規約・プライバシーポリシーの英語版(確定した日本語原本からの別作業)、GAP-06 RESOLUTEの入口、GAP-07 記事タイトル、GAP-08 英語時のブラウザタイトル、GAP-09 FAQのiPhone追加方法(実際の対応を確認してから)、GAP-10 資本マップの件数の単複。
