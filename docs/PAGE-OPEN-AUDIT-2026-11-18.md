# ページの開き方の監査（2026-11-18）

オーナー指摘（銘柄手帳が3段階くらいで開く。「違和感ある開き方のページがあまりにも多い。全部チェックしたほうがいい」）を受けた全ページの計測。

## 計測方法

- 本番 techphase.app を **未ログイン** で読み込み（GETのみ。本番の設定・データは変更していない）。
- WebKit（iPhone 13 表示、日本語・日本時間）で、`main` の文字数と高さを30msごとに記録し、文字数15字超または高さ24px超の変化が120ms以上続いたものを「段階」として数えた（真っ白の状態は数えない）。
- CLS は Chromium（iPhone 13 表示、回線 150ms・1.5Mbps、CPU 4倍遅く）の layout-shift で計測（WebKitは layout-shift を出さないため）。
- 会員ページ（銘柄手帳・ウォッチリスト）は、ローカルの本番ビルドで会員APIを遅延付きで差し替えて計測（PRO会員、保存リスト5銘柄）。

## 会員として開いた場合（修正前 → 修正後、同じ条件）

| ページ | WebKit 修正前 | WebKit 修正後 | Chromium 修正前 | Chromium 修正後 |
|---|---|---|---|---|
| `/research/notebook` | 4段階 / CLS 0 | 2段階 / CLS 0 | 4段階 / CLS 0.1374 | 2段階 / CLS 0.0006 |
| `/research/watchlist` | 2段階 / CLS 0（全画面の読み込み画面→本体） | 2段階 / CLS 0（本体の枠と行の下地→本体） | 2段階 / CLS 0.0059 | 2段階 / CLS 0.0076 |

銘柄手帳の修正後の2段階は「完成時と同じ大きさの下地」→「全体」の1回の差し替え。

## 全ページ（本番・未ログイン、修正前）

| ページ | 見える段階 | CLS | 原因 | 対応 |
|---|---|---|---|---|
| `/research` | 5 | 0.0053 | 起動画面→本体→上部LIVE帯が後から差し込まれる | 未対応（重複）: 上部ニュース帯・ヘッダー初回表示は別作業 claude/themes-desk-topnews・claude/flash-load-header-paint |
| `/research/notebook` | 3 | 0.1003 | リスト確認中→枠と2つの「集計中」→株価タイル→記事が別々に到着（会員で4段階） | 修正: 完成時と同じ大きさの下地を出し、リスト・会員確認・株価・ニュースがそろってから一度に表示。ニュース取得はリスト確認を待たずに開始 |
| `/research/watchlist` | 3 | 0.0101 | 全画面の読み込み画面（サイドバーなし）→本体の枠に差し替え→株価 | 修正: 本体の枠のまま68px行の下地を表示（読み込み画面を経由しない） |
| `/research/news` | 2 | 0.0048 | 読み込み画面→一覧 | 未対応（重複）: ハイテク速報の読み込みは claude/flash-load-header-paint |
| `/research/general-news` | 2 | 0.0048 | 一覧が後から到着 | 未対応（重複）: 速報と同じ部品 general-news-panel を claude/flash-load-header-paint が変更中 |
| `/research/stocks` | 1 | 0.0052 | 事前描画ページで useSearchParams により全体がブラウザ描画（読み込み画面が一瞬出る） | 修正: リクエストごとに描画（connection()）し、最初のHTMLに検索画面を含める |
| `/research/companies` | 2 | 0.007 | 株価の数字が後から入る（位置は固定） | 問題なし |
| `/research/companies/NVDA` | 3 | 0.2154 | 株価カードが小さい読み込み表示→242pxのカードに拡大（CLS 0.22） | 修正: 読み込み中もカードの高さを確保 |
| `/research/quote/NVDA` | 4 | 0.493 | 1行の「読み込み中」→株価ブロック125px、チャート枠が後から出現（CLS 0.49） | 修正: 株価ブロックとチャート枠（凡例を含む）の高さを先に確保 |
| `/research/market` | 4 | 0.0231 | 「チャートを読み込み中」1行→チャート枠と4本値の行が後から出現 | 修正: チャート枠と4本値の行の場所を先に確保 |
| `/research/market/index/sp500` | 2 | 0.3644 | 銘柄詳細と同じ（CLS 0.36） | 修正: 銘柄詳細と同じ部品の修正で解消 |
| `/research/calendar` | 2 | 0.162 | 240pxの下地→一覧（下地より長く、下が押される） | 既存の下地あり。残り: 一覧の長さが下地より長い分のずれ |
| `/research/radar` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/themes` | 2 | 0.0824 | 一覧が後から到着 | 未対応（重複）: テーマランキングは claude/themes-desk-topnews |
| `/research/themes/ai-chips` | 2 | 0.0087 | 同上 | 未対応（重複） |
| `/research/compare` | 1 | 0.0049 | 一度で表示 | 問題なし |
| `/research/compare/sample` | 1 | 0.0053 | 一度で表示 | 問題なし |
| `/research/capital-map` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/capital-map/sample` | 1 | 0.005 | 一度で表示 | 問題なし |
| `/research/price-targets` | 2 | 0.0485 | 「接続中…」1行→一覧 | 未対応（下地の大きさが件数で変わる） |
| `/research/notes` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/qa` | 3 | 0.059 | RIZEL'S DESKの画面が段階表示 | 未対応（重複）: claude/themes-desk-topnews |
| `/research/qa/answered`（→ /research/qa） | 3 | 0.059 | 同上 | 未対応（重複） |
| `/research/weekly` | 2 | 0.0378 | 同上 | 未対応（重複） |
| `/research/questions` | 1 | 0.0049 | 一度で表示 | 問題なし |
| `/research/columns` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/editorial` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/learn` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/faq` | 2 | 0.328 | スマホ向け「ホーム画面に追加」の案内が表示後に先頭へ差し込まれる（CLS 0.33） | 修正: 端末判定をサーバー側で行い、最初のHTMLに含める |
| `/research/portfolio`（→ /research/account） | 3 | 0.0229 | 未ログインで /research/account へ | 未対応（ログイン後は未計測） |
| `/research/notifications` | 2 | 0.0443 | 設定の行が後から少し増える | 軽微 |
| `/research/account` | 3 | 0.0889 | 未ログイン: Clerkのログイン部品が2段階で出る | 未対応: Clerk側の部品 |
| `/research/account/billing`（→ /research/account） | 3 | 0.0842 | 未ログインで /research/account へ | 未対応: 同上 |
| `/research/account/cancel`（→ /research/account） | 3 | 0.0842 | 同上 | 未対応 |
| `/research/account/delivery` | 2 | 0.035 | — | — |
| `/research/account/members` | 2 | 0.035 | — | — |
| `/research/account/security`（→ /research/account） | 3 | 0.0842 | 同上 | 未対応 |
| `/research/account/sign-up` | 3 | 0.1046 | Clerkの登録部品 | 未対応 |
| `/research/pro-experience` | 1 | 0.0049 | 一度で表示 | 問題なし |
| `/research/watchlist/sample` | 1 | 0.0063 | 一度で表示 | 問題なし |
| `/research/health`（→ /research/radar） | 2 | 0 | — | — |
| `/research/write` | 2 | 0.0002 | — | — |
| `/research/review` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/intake` | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/research/inbox-key`（→ /research/notes） | 1 | 0.0048 | 一度で表示 | 問題なし |
| `/resolute` | 1 | 0.0024 | 一度で表示 | 問題なし |
| `/resolute/lp` | 1 | 0.0024 | 一度で表示 | 問題なし |
| `/resolute/lp/en` | 1 | 0.0086 | 一度で表示 | 問題なし |
| `/resolute/alerts` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/alerts/latest` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/news` | 3 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/notebook` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/morning` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/tonight` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/thermometer` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/wall` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/tax` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/settings` | 3 | 0.088 | 設定の読み込みで行が増える（CLS 0.09） | 未対応 |
| `/resolute/simulation` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/diagnosis` | 2 | 0.0002 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/review` | 4 | 0.198 | ゲート→本文（CLS 0.20） | 未対応（会員ページ、未ログインでは本来の画面を計測できず） |
| `/resolute/receive` | 2 | 0 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/recovery-check` | 1 | 0 | 一度で表示 | 問題なし |
| `/resolute/ai-check` | 2 | 0 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/checkout` | 2 | 0.0016 | 未ログイン: 入口の案内が出てから会員ゲートの画面に切り替わる | 未対応（会員ログイン後の画面は未計測） |
| `/resolute/notification-preview` | 1 | 0 | 一度で表示 | 問題なし |
| `/resolute/legal/commerce` | 1 | 0.0048 | 一度で表示 | 問題なし |

`/resolute/recovery-check` は本番で404。
