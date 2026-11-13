# 銘柄比較: 財務を SEC 優先にする検証（2026-11-13）

## 方式
- 財務（売上・営業利益・前年同期・直近4四半期の営業利益率・貸借対照）は SEC（companyfacts / submissions / inline XBRL）。Twelve Data のクレジットは使わない。
- Twelve Data は、SEC が出せない会社（外国 20-F、四半期欠け）の財務と、価格系だけに使う: 価格系列（time_series 1クレジット/銘柄、1時間共有）と予想PER（statistics 50クレジット/銘柄、24時間共有）。
- 予想PERの代替: SEC に予想は無いので statistics を 24h 共有で残す（取れない時は割安性を「—」）。負債・現金・流動比率は SEC の貸借対照、安定性は SEC の直近4四半期。

## 実データでの突き合わせ（27銘柄、同日取得）
現行（Twelve Data income_statement + cash_flow）とサイトの SEC 経路を同じ期末で比較。

| 結果 | 銘柄 |
|-|-|
| 同じ期末で対にできた 23 値のうち 22 が一致（誤差 0.1% 以内） | NVDA, CRDO, AVGO（売上）ほか |
| 不一致 1 件: AVGO 営業利益 SEC 159.6億 / TD 160.6億（0.6%、定義差） | AVGO |
| SEC が最新四半期（9月期）、Twelve は 6月期のまま（Twelve が1四半期古い） | AMD, INTC, TXN, TSM, ARM, ACLS, ALAB, AMKR, COHR, FORM, INDI, MX, NVTS, ONTO, WOLF, AEHR |
| 第4四半期の単独開示なし → 年度−9か月累計で導出（PR #502） | MU（売上542.29億ドル）, QCOM（103.22億ドル） |
| 売上タグの違いで読めなかった → 修正（PR #502） | LITE |
| SEC に四半期 XBRL なし（20-F / 外国）→ Twelve Data に落とす | ASML, CAMT, SIMO, TSEM, UMC（SEC 一覧に無し） |
| XBRL に営業利益タグ自体が無い → 営業利益率は「—」（数字を作らない） | COHR |

結論: 米国国内の 10-K/10-Q 提出会社では「即時・最新・どの銘柄でも」が成立し、鮮度は Twelve Data より新しい。外国 20-F 企業は Twelve Data のまま（財務の2層 TTL は別途）。

## クレジット見積り（Twelve Data、共有キー 610/分）
前提: 会員のうち当日利用 20%、ピーク時間に 1 人 3 回 × 3 銘柄、固有銘柄はピーク1時間に約 90、Twelve 落ち銘柄は新規の 15%。

| | 1回の比較（3銘柄） | ピーク/分 300人 | ピーク/分 3,000人 |
|-|-|-|-|
| 現行（4呼び出し、6h キャッシュ） | 最大 約 750 | キャッシュミス次第で 610 超過あり | 超過 |
| SEC 優先 + series + statistics | 3（series）＋ statistics ミス時 50/銘柄 | 約 30〜60 | 約 190（series 約 90→共有で約 60 ＋ statistics 新規 約 75 ＋ Twelve 落ち 約 56） |
| SEC 優先（statistics なし） | 3 | 約 10 | 約 115 |

3,000人でも約 190 クレジット/分（610 の約 3 割、目標の半分 305 以下）。statistics を残す。使用量ゲート（PR #499）は取得前に 350 を超える分を待たせる。

## 順位が付く組み合わせの変化（退行ゼロの確認）
監視銘柄（providers.json の先頭22社: MU, SKHY, SNDK, NBIS, NVDA, AMD, AVGO, ARM, TSM, ASML, MRVL, ANET, CRDO, CRWV, VRT, GEV, DELL, PLTR, MSFT, BE, GOOGL, ORCL）の2社ペア231組で、切替前後の「順位が付く／付かない」を実データ（2026-11-13 の SEC と Twelve Data の最新四半期末）で比較。
切替前=全社 Twelve Data（四半期末のずれ 100 日以内）、切替後=SEC が使える会社は SEC・使えない会社（ASML・SKHY・NBIS 等の20-F／年次のみ、MRVL のように新しい発表が未確認の会社）は Twelve Data。

| 混在時の窓 | 順位あり（切替前→後） | 失う組み合わせ | 増える組み合わせ |
|-|-|-|-|
| 31日（SEC×Twelve で四半期末が1か月以内のみ） | 231 → 166 | 65（SEC が1四半期新しく、Twelve 落ちの会社と100日以内でも31日を超える） | 0 |
| **100日（従来と同じ窓。採用）** | **231 → 231** | **0** | 0 |

採用: 比較可否は「四半期末のずれ 100 日以内」。Twelve Data の標準化財務は SEC の提出書類とも比較できる（今日と同じ）。SEC の会計基準が2つ（US GAAP と IFRS）になる組み合わせは従来どおり順位なしなので、IFRS の SEC 会社（TSM 等）は今日と同じく Twelve Data の財務を使い、Twelve が取れない時だけ SEC を使う。画面は各社の出所を表示。上の表の「100日」の行はこの規則での結果（失う組み合わせ0）。
