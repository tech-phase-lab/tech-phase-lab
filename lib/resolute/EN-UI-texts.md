# RESOLUTE English UI texts (Claude draft, ②〜⑥)

Natural, plain English. Not word-for-word. Please correct freely.
Numbers: JA "万円" screens become USD or yen as the product decides. Keep "Tolerable loss" etc. consistent with ① diagnosis EN.
Mail bodies and ④ subject lines: already in lib/mail-templates.ts (EN).

## Shared
| JA | EN |
|---|---|
| ① 診断 / ② シミュ / ③ 通知 / ④ 翌朝 / ⑤ 温度計 / ⑥ 税金 | ① Quiz / ② Simulator / ③ Alerts / ④ Morning note / ⑤ Gauge / ⑥ Tax |
| 日本語 (language switch) | English |
| 情報の提供であり、投資助言ではありません。 | For information only. Not investment advice. |

## ② Simulator
| JA | EN |
|---|---|
| 資産額シミュレーション | Portfolio simulator |
| 下落時 / 上昇時 | If it falls / If it rises |
| もしも、持っている株が下がったら？ | What if your holdings fall? |
| 下落率 | Drop |
| いまの保有額 | Current holdings |
| 上がったら？ / 上昇率 / いまの保有 | What if they rise? / Rise / Current holdings |
| あなたのルール | Your rules |
| 診断の結果が自動で入ります。ここでは例です。 | Filled in from your quiz result. Sample values here. |
| 毎月の生活費 / 許容できる下落 / 1銘柄の上限 | Monthly living costs / Tolerable loss / Single-stock cap |
| 〇段階目 | Step 1 / Step 2 … |
| 〇%下がったら | If it falls 〇% |
| あなたの資産は 〇〇減ります | Your assets would fall by 〇〇 |
| 生活費〇か月分にあたります | About 〇 months of living costs |
| ✓ 許容の範囲内です。 | ✓ Within your tolerance. |
| 許容額まで、あと〇〇の余裕があります。 | You have 〇〇 of room left before your limit. |
| ⚠ 許容額を〇〇超えます。 | ⚠ This is 〇〇 over your limit. |
| ルールを読み直す目安です。 | A cue to reread your rules. |
| 到達 / まだ先 | Reached / Not yet |
| 下がったあとの保有額 | Holdings after the drop |
| 買い増しのルール | Buy-more rules |
| −〇%まで下がると、金色のラインに届きます | At −〇%, you reach the gold line |
| ここまでの買い増し予定 | Planned buys so far |
| 〇〇が上限を超えます。 | 〇〇 goes over your cap. |
| 1銘柄の上限は〇%です。割合を確かめる目安です。 | Your single-stock cap is 〇%. Use this to check your mix. |
| ✓ すべて上限の範囲内です。 | ✓ All within your cap. |
| 合計〇〇になります | Total: 〇〇 |
| 縦の線が、1銘柄の上限です。 | The vertical line is your single-stock cap. |
| 将来を予測するものではありません。入力した前提での計算です。 | Not a forecast. Based only on the numbers you entered. |
| 銘柄A / B / C, 名前なし | Stock A / B / C, Unnamed |

## ③ Closing-price alerts
| JA | EN |
|---|---|
| 終値アラート | Closing-price alerts |
| ラインに届いた日に、メールでお知らせ | Get an email on the day a line is hit |
| 見る銘柄 / ＋ 銘柄を追加 | Stocks to watch / + Add a stock |
| 銘柄 / 基準 / 消す | Symbol / Base price / Remove |
| 銘柄と基準価格を入れてください | Enter a symbol and base price |
| 知らせるライン | Alert lines |
| あなたのルールの買い増しラインです | These are the buy-more lines from your rules |
| 上昇の目安も知らせる | Also alert me on a rise |
| 上昇の目安 | Rise level |
| 届く時間 | Delivery time |
| 前の夜の終値をもとに、この時間にお知らせします(日本時間) | Based on the previous night's close, sent at this time (JST) |
| あなたのライン | Your lines |
| もしも、ある日の終値が基準から〇〇だったら？ | What if a day's close is 〇〇 from your base? |
| 終値の変化 | Close vs. base |
| 基準から〇%上がったら | If it rises 〇% from base |
| 届くメールの例を見る | See an example email |
| 今日は届きません / メールは送られません | No alert today / No email will be sent |
| 通知は、米国市場の終値が確定したあとに送ります。 | Alerts are sent after the US market close is final. |

## ④ Morning note
| JA | EN |
|---|---|
| 翌朝のひとこと | Morning note |
| お知らせの翌朝に、1通だけ届きます | One short email the morning after an alert |
| 翌朝のひとことを受け取る | Get the morning note |
| 初めはオフです。オンにすると、お知らせと同じ時間に届きます。 | Off by default. When on, it arrives at the same time as your alerts. |
| オフになっています。 / 翌朝のメールは届きません。 | It's off. / No morning email will be sent. |
| 届くメールの例 | Example email |
| いまの気持ちに近いものを、1つだけ選んでください。 | Pick the one that feels closest right now. |
| 計画どおり動いた / 見送った / まだ迷っている | I followed my plan / I held off / I'm still unsure |
| 計画を開く / 選び直す | Open my plan / Choose again |
| どれを選んでも、正解・不正解はありません。 | There's no right or wrong answer. |
| このメールは、昨日のお知らせについて1回だけ届きます。 | You'll get this email once, about yesterday's alert. |

Tips shown after choosing:
- Followed my plan: "A night when you stuck to your plan is worth noting. Check in one line: did what you did match what you wrote in your rules? It makes the next drop easier to face."
- Held off: "Holding off is one of the choices in your rules. Check whether your reason is already in your 'don't buy' conditions. If not, add it, and you won't second-guess next time."
- Still unsure: "Being unsure can mean your rules and how you felt that night don't quite match. No need to rush. Open your plan and reread your lines and buy amounts."

## ⑤ Market gauge
| JA | EN |
|---|---|
| 相場の温度計 | Market gauge |
| いまの相場の位置を、ひと目でつかむ | See where the market stands at a glance |
| 行き過ぎのメーター | Overheating meter |
| 更新: 2027年1月15日 7:00(例) | Updated: Jan 15, 2027, 7:00 JST (sample) |
| かなり冷えている / 冷えている / ふつう / 熱い / かなり熱い | Very cold / Cool / Neutral / Hot / Very hot |
| 4つの位置 | The 4 positions |
| マスを押すと、説明が出ます。 | Tap a box to see what it means. |
| ◀ 冷えている / 行き過ぎ / 熱い ▶ | ◀ Cool / Stretched / Hot ▶ |
| 上向き ↗ / 下向き ↘ | Up ↗ / Down ↘ |
| トレンド | Trend |
| いまここ | You are here |
| 上向き × 熱い | Up × Hot |
| 　上昇が続いていて、相場の価格が最近の水準より高い状態です。 | The market keeps rising, and prices are above their recent level. |
| 上向き × 冷えている | Up × Cool |
| 　上昇が続いていますが、相場の価格は最近の水準より低い状態です。 | The market is rising, but prices are below their recent level. |
| 下向き × 熱い | Down × Hot |
| 　下落が続いていますが、相場の価格は最近の水準より高い状態です。 | The market keeps falling, but prices are still above their recent level. |
| 下向き × 冷えている | Down × Cool |
| 　下落が続いていて、相場の価格が最近の水準より低い状態です。 | The market keeps falling, and prices are below their recent level. |
| セクター別 | By sector |
| 半導体 / クラウド・AI / ソフトウェア / 通信機器 / ヘルスケア | Semiconductors / Cloud & AI / Software / Networking / Healthcare |
| 通知の利用権 | Alerts access |
| この温度計の判断のしかた | How this gauge works |
| 更新のタイミング | When it updates |
| 米国市場の終値が確定したあと、1日1回、更新します。 | Once a day, after the US market close is final. |
| トレンドの見方 / 行き過ぎの見方 / データの出どころ | How we read the trend / How we read overheating / Data source |
| 準備中です。 | Coming soon. |
| これからの値動きを当てるものではありません。あくまでも一つの指標として捉えてください。 | This does not predict future moves. Treat it as one indicator among many. |

## ⑥ Tax estimate (Japan)
| JA | EN |
|---|---|
| 税金の目安 | Tax estimate |
| 日本在住の方向け ・ 2026年分の売却 | For Japan residents · 2026 sales |
| 売却したとき / 損切りしたとき | When you sell / When you cut a loss |
| 口座の種類 | Account type |
| 特定口座 / 源泉徴収ありの特定口座 | Specific account / With tax withheld |
| 一般口座 / 特定口座の源泉徴収なしを含みます | General account / Includes specific accounts without withholding |
| NISA口座 / 利益は非課税として計算します | NISA account / Gains are treated as tax-free |
| 今年の売却代金の合計 | Total sale proceeds this year |
| その購入額の合計 | Total purchase cost of those shares |
| くわしく設定する | More settings |
| 手数料 | Fees |
| 確定する損 | Loss to lock in |
| 今年のほかの利益 | Other gains this year |
| あなたの手取りの目安は | Your take-home estimate |
| この売却の損益 | Profit or loss on these sales |
| 税金の目安 | Estimated tax |
| 税金を引いたあとの損益 | Profit or loss after tax |
| 税金は 約〇〇少なくなる計算です / 変わらない計算です | Tax would drop by about 〇〇 / would stay the same |
| 確定する前の税金 / 確定したあとの税金 | Tax before locking in / Tax after locking in |
| 繰り越せる損失 | Loss you can carry forward |
| 入力した条件で、相殺できた場合の計算です。損を確定するかどうかは、ご自身で決めてください。 | Calculated assuming the loss offsets your gains as entered. Whether to lock in a loss is your decision. |
| この計算の前提 | What this assumes |
| 税率 20.315% | Tax rate: 20.315% |
| 所得税 15% / 住民税 5% / 復興特別所得税 所得税額の2.1% | Income tax 15% / Resident tax 5% / Reconstruction surtax 2.1% of income tax |
| 計算に含まないもの | Not included |
| 配当や給与などのほかの所得 | Dividends, salary and other income |
| 外国税額控除などの特例 | Special rules such as foreign tax credits |
| 為替レートの扱い | Exchange-rate treatment |
| 手数料以外の費用 | Costs other than fees |
| 前年までの繰越損失 | Losses carried over from prior years |
| 入力した条件に基づく概算であり、税務相談ではありません。 | An estimate based on what you entered. Not tax advice. |

Note texts (shown under results):
- nisa_tax_free: NISA gains are treated as tax-free.
- nisa_loss_not_deductible: Losses in a NISA account can't offset gains elsewhere or be carried forward.
- carryforward_used: Losses you carried forward by filing a tax return have been deducted.
- carryforward_expired: Losses past the carry-forward period (3 following years) were not deducted.
- net_loss_this_year: Your total for the year is a loss. File a tax return to carry it forward for the next 3 years.
- filing_required (general): With a general account, you must file a tax return yourself if you have a gain.
- filing_required_for_carryforward: Even with a specific account, carrying losses forward or netting against other gains requires a tax return.
- carryforward_requires_filing: Losses that can't be fully offset can be carried forward for the next 3 years by filing a tax return.
- withholding_account_year_end_settlement: In a specific account with withholding, gains and losses in the same account are settled at year end. Check your broker's annual report for the actual refund or payment.
- Year not supported: Tax rules for {year} aren't supported yet. Supported: {years}.
