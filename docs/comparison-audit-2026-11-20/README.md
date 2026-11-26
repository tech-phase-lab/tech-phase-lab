# 銘柄比較PRO 長所・短所の見直し（2026-11-20）

> **2026-11-26 追記（運営者の判断）:** 銘柄比較は「取引所に上場する個別株のみ」になりました。優先株・社債（PMTW など、下の 11/20 の
> 「NYSE の社債は外さない」を取り消し）、ETN、ワラント、ユニット、ライツ、クローズドエンド型ファンド、ETF、SPAC、ロイヤルティ／暗号資産の
> 信託を外し、OTC（店頭）と取引所未定（IPO）のティッカーも候補から外します。普通株・取引所上場の ADR・BDC・REIT・銀行と、複数の種類株
> （GOOGL/GOOG など）は残します。判定は `lib/research/comparison-exclusions.ts`、一覧は `comparison-exclusions.json`（`instrument`・
> `fund`・`spac`、`scripts/research/comparison-audit/instruments.py` で作成）。
>
> **2026-11-26 夜 追記（数値の正しさの監査）:** 全 5,268 銘柄で、採点に使う数値が常識の範囲（利益率・簡易FCF率が ±100%、売上成長が
> +1000%／−95%）を外れる会社を洗い出し、原因を調べた（修正前 898 社 → 修正後 766 社）。誤りだったものは直し、意味を持たない比率は
> 理由を添えて出さない。利益率が 100% を超える会社（49 社: YUM、MSTR、BBVA など。営業利益に売却益などが入る、または売上欄が一部だけ）と、
> 簡易FCF率が 100% を超える会社（75 社: 銀行・証券・保険は融資や預金でキャッシュフローが動くため ROE で比べる。それ以外は前受金など
> 売上でない入金）は 0 社になった。残る 766 社は提出書類どおりの値（売上が小さい会社の大きな赤字・資金流出、マイルストーン収入や買収に
> よる大きな増減）。売上を書類の標準項目で読めなかった会社は、同じ売上の「丸めた値」との重複（AECOM など）、税込み売上との併記
> （Cronos など）、投資銀行の手数料だけの売上（Moelis）を直した。Twelve Data が普通株と登録している社債・優先株・ライツ（AGNCZ、
> RWAYI、ADAMH など）、同社の一覧に無いユニット・社債・ロイヤルティ信託（DUKU、PPLC、WHLRL、VOC）、ファンドに転換した会社（EARN など）
> も外した（5,280 → 5,268）。
>
> **2026-11-26 深夜 追記（2回目の独立レビューの指摘をすべて修正）:** 総合評価は、全社が同じ種類の物差し（通常の項目／売上の無い会社の
> 項目／金融機関の項目）で測られている項目だけで出し、3項目未満なら出さない。売上の無い会社や金融機関向けの項目で採点した会社を、
> 通常の項目の会社より上（または拮抗）とは言わない。「売上がまだ無い」は、売上原価・粗利・区分別の売上が一つでもあれば出さず、
> 最新の書類が読めないときは「読み取れない」とする（MTH、RERE、AQMS、AUC）。純受取利息は、費用がそれを上回る会社の売上にはしない
> （NNI、BKKT）。IFRS 銀行は総額の営業収益を優先（HSBC +10.6%、47.6%）。同じ借入の二重計上を除き、負債合計を超える借入は不明扱い
> （RJF、COLB、HNVR、ATLC）。割安性の一覧はモニターの別の応答（/value-check/values）に分け、トレジャーハントの応答は本番の上限
> 1.5MB のまま。OP ユニット（ESBA、FISK、OGCP）を外し、合併済みの VRXA を戻した（5,268 → 5,266）。

運営者の依頼（11/20）: 「長所・短所出てない銘柄は全チェックして追加してください」。続けて
「完全にないと判断したなら無理に書かなくていいですよ。逆におかしくなる。」
そのため、提出書類の事実から言える長所・短所だけを足し、基準に当たらない会社に要点を作ることはしない
（いったん作った「他の項目より低め」の相対の要点は取り下げた）。

対象と方法は 11/19 の監査（`docs/comparison-audit-2026-11-19/README.md`）と同じ。SEC の会社一覧の上場ティッカー 7,668 を
`scripts/research/comparison-audit/audit.mjs` で本番と同じサーバーコードに通し、`summarize-items.py` で数えた。
修正前は origin/codex/research-preview（5ea7fc91）、修正後は claude/comparison-items-fill。SEC の数値は 11/20 に取り直したため、
修正前の数は 11/19 の表（長所0 466・短所0 678）と少し違う。銘柄ごとの結果は `items.csv`。

## 追加・変更

1. 株主資本がマイナス（短所）: 同じ期末・同じ通貨の株主資本（親会社分、なければ非支配持分込み）が記載され、0 未満のとき。
   366 社（MO −22.25 億ドル、PM、ABBV など）。
2. 売上前四半期比（長所・短所）: 前年同期の売上がなく、成長性を前四半期比で採点している会社だけ（採点と同じ数字）。長所 30・短所 20。
3. Nasdaq のワラント・ユニット・権利の判定を広げた: 同じ会社の別のティッカーに 1〜2 文字を足し、末尾が W・U・R のもの
   （これまでは 4 文字の本体＋1 文字だけ。本体が 3 文字の MOBBW が検索に残っていた）。新たに候補から外す 40 銘柄:
   MOBBW, GENVR, BNCWW, HTZWW, XRXDW, PCTTU, PCTTW, RUMBW, ICUCW, XBPEW, DJTWW, KDKRW, ECXWW, FGIWW, ZEOWW, PRENW, PGYWW,
   GGROW, FLDDW, CDTTW, VFSWW, SBCWW, SDAWW, SMXWW, OCSAW, BCGWW, OIOWW, LOTWW, CCGWW, MNYWW, PBMWW, DSYWW, GCLWW, FVNNR,
   FVNNU, BGLWW, TMSWW, FACWW, WTGUR, WTGUU。普通株・種類株（GOOGL など）、NYSE の社債（PMTW など）は外さない。
4. キャッシュのキーを v13 に更新（保存済みの要点を作り直す）。

## 結果

| | 比較に出る銘柄 | 長所0 | 短所0 | 両方0 | 要点なし（データ） |
|---|---|---|---|---|---|
| 修正前 | 5,765 | 467 | 676 | 1 | 854 |
| 修正後 | 5,725 | 447 | 658 | 1 | 845 |

内訳: 外した 40 銘柄で 長所0 −8・短所0 −2・要点なし −9。事実の追加で 長所0 −12（売上前四半期比）・短所0 −16（主に株主資本マイナス）。

| 会計基準 | 銘柄 | 長所0 | 短所0 | 両方0 | 要点なし（データ） |
|---|---|---|---|---|---|
| US GAAP | 4,713→4,687 | 405→388 | 540→525 | 1 | 332→331 |
| IFRS | 564→557 | 62→59 | 136→133 | 0 | 34→33 |
| なし | 488→481 | 0 | 0 | 0 | 488→481 |
| 計 | 5,765→5,725 | 467→447 | 676→658 | 1 | 854→845 |

### 片側が残った会社の理由（修正後）

- 短所0 658: 638 は採点項目がすべて長所の基準以上か、短所の基準に届かない中間（例: A, AA, HSBC, TSM, COST）。19 は採点できる項目が
  すべて長所（UBS・Barclays・Deutsche Bank の ETN。銀行本体の数値）。1 は採点項目が 1 つ（RVII）。
- 長所0 447: 446 は長所の基準に届かない中間か短所、1 は採点項目が 1 つ（RVII）。
- 両方0 1: RVII（ファンド、採点は株価だけ）。

本番ではこれに加えて、約3か月の株価が下がった銘柄に短所、+20% 以上で長所が付く（株価は監査外）。

要点なし（データ）845 の内訳（対象外）: 比較に使える四半期データなし 581、直近期間を確認できない 264。

## 抜き取り確認（修正後、日本語の画面表示）

- MO: 短所 流動比率 0.58倍・有利子負債が現金を上回る・株主資本がマイナス（新規）
- PM・ABBV: 短所に 株主資本がマイナス を追加
- GEF: 短所 売上前四半期比 −1.9%（新規）／ SKYD: 長所 売上前四半期比 +1.6%（新規）
- BTI（IFRS 半期）: 短所 流動比率 0.84倍・有利子負債が現金を上回る（変更なし）
- JPM（銀行）: 短所 有利子負債が現金を上回る・営業利益率 48.0→40.1%（変更なし）
- O（REIT）: 短所 営業利益率 23.1→20.7%（変更なし）
- A, AA, HSBC, TSM, COST: 短所なし（基準に当たる短所がない。作らない）

## 追加: ETN（上場投資証券）を候補から外す（運営者の判断 11/20）

ETN は銀行が発行する債券で、指数（VIX 先物、BDC、金、FANG+ など）に連動して払い戻される。SEC の会社一覧は ETN を発行銀行の CIK に
登録しているため、比較は ETN を発行銀行自身の決算（売上・利益率など）で採点していた。上の「短所0」のうち UBS・Barclays・Deutsche Bank
の ETN（19 と数えた分を含む 22 銘柄）は長所だけ、Bank of Montreal・JPMorgan の ETN 46 銘柄は銀行本体の要点が出ていた。
SPAC・ファンドと同じく検索候補に出さず、直接指定（古いリンク・API）は「比較できない銘柄」（unknown-company）、背景ジョブは決算書の
クレジットを使わない。画面の文言は変えない。

判定（`lib/research/comparison-exclusions.ts`、一覧は `comparison-exclusions.json` の `etn`、`excluded.py` の `ETN_ISSUERS` で作成）:
ETN を発行する銀行の CIK に登録されたティッカーのうち、その銀行自身の株（DB, BMO, JPM, GS, MS, C）以外。CIK は法人ごとに固定なので、
同じ銀行が新しく出した ETN も自動で外れる。発行体と根拠（各社の提出書類で確認）:

| 発行体（CIK） | 自社株（残す） | 外す ETN |
|---|---|---|
| UBS AG（1114446、ETRACS） | なし（UBS は UBS Group AG 1610520） | AMUB, BDCX, BDCZ, CEFD, HDLB, IFED, MLPB, MLPR, MVRL, PFFL, SMHB, UCIB |
| Barclays Bank PLC（312070、iPath ほか） | なし（BCS は Barclays PLC 312069） | ATMP, DJP, GBUG, GRN, TAPR, VXX, VXZ, BWVTF（OTC）, JJETF（OTC） |
| Credit Suisse AG（1053092、X-Links。現 UBS） | なし | GLDI, SLVO, USOI |
| Deutsche Bank AG（1159508、DB ETN） | DB | DGP, DGZ, DZZ, ADZCF（OTC）, DEENF（OTC）, OLOXF（OTC。2019 年 4 月の 424B3） |
| Bank of Montreal（927971、MicroSectors・MAX） | BMO | AIQD, AIQU, BERZ, BNKD, BNKU, BRZD, BRZL, BULZ, CARD, CARU, DULL, FLYD, FLYU, FNGD, FNGO, FNGS, FNGU, GDXD, GDXU, GLLD, HYGD, HYGU, JETD, JETU, JPND, JPNU, LQDD, LQDU, MNGU, NRGD, NRGU, OILD, OILU, SMHD, SMHU, SPYU, TAWN, TPEI, WTID, WTIU, XLCD, XLCU, XLPD, XLPU |
| JPMorgan Chase & Co（19617） | JPM | AMJB（Alerian MLP ETN）, VYLD（Inverse VIX ETN。10-K 2025 の別紙 4.6） |
| Goldman Sachs Group（886982） | GS | GSCE（OTC。GS Connect ETN、旧 GSC） |
| Morgan Stanley（895421）, Citigroup（831001） | MS, C | なし（今は優先株だけ。将来の ETN に備えて登録） |
| 各社の発行用子会社: JPMorgan Chase Financial（1665650）, GS Finance（1419828）, Morgan Stanley Finance（1666268）, Citigroup Global Markets Holdings（200245） | — | なし（今の一覧に上場ティッカーなし） |

計 77 ティッカー（上場 71・OTC 6）。優先株（JPM-PC など）はこれまでどおり優先株として外れる。残すもの: 各銀行の自社株と親会社の株
（UBS, BCS, DB, BMO, JPM, GS, MS, C）、ETN を発行していない銀行（RY, HSBC, NMR, BAC などと、その OTC の普通株 RYLBF, BCLYF など）、
Morgan Stanley の暗号資産信託（MSBT などは既にファンドとして除外）。`excluded.py` は他の銀行・証券会社に自社株と優先株以外の上場
ティッカーがないかも表示する（11/20 は Bradesco の BBDO〈優先株〉や地銀の Nasdaq 優先株・社債だけで、ETN はなかった）。
構造化信託（STRATS、CORTS、Merrill Lynch Depositor の IndexPlus など、発行体が信託そのもの）は ETN ではないため今回は扱っていない。

影響（11/20 の `items.csv`、比較に出る 5,725 から上場 71 銘柄を除く。再監査はしていない）: 比較に出る銘柄 5,725→5,654、
短所0 658→636（長所だけの ETN 22）、長所0 447（変化なし）、両方0 1（変化なし）、要点なし（データ）845→842（GLDI, SLVO, USOI）。
