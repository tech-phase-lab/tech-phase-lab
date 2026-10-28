// Question copy and input metadata supplied by Claude.
export const QUESTIONS_JA = [
  {
    "id": "q01",
    "s": "A",
    "text": "投資を始めてどのくらい？",
    "o": [
      {
        "id": "first",
        "label": "はじめて"
      },
      {
        "id": "1to3",
        "label": "1〜3年"
      },
      {
        "id": "3to5",
        "label": "3〜5年"
      },
      {
        "id": "5to7",
        "label": "5〜7年"
      },
      {
        "id": "7to10",
        "label": "7〜10年"
      },
      {
        "id": "10plus",
        "label": "10年以上"
      }
    ]
  },
  {
    "id": "q02",
    "s": "A",
    "text": "毎月の生活費はいくら？",
    "field": "monthlyLivingCost",
    "o": [
      {
        "id": "l15",
        "label": "〜15万円",
        "val": 150000
      },
      {
        "id": "l25",
        "label": "15〜25万円",
        "val": 250000
      },
      {
        "id": "l40",
        "label": "25〜40万円",
        "val": 400000
      },
      {
        "id": "l40plus",
        "label": "40万円〜",
        "val": 400000
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "万円",
          "mult": 10000
        }
      }
    ]
  },
  {
    "id": "q03",
    "s": "A",
    "text": "収入は安定している？",
    "o": [
      {
        "id": "stable",
        "label": "毎月ほぼ同じ"
      },
      {
        "id": "uneven",
        "label": "波がある"
      },
      {
        "id": "none",
        "label": "今は収入がない"
      }
    ]
  },
  {
    "id": "q04",
    "s": "A",
    "text": "貯金は、生活費の何か月分ある？",
    "field": "savingsMonths",
    "o": [
      {
        "id": "m0",
        "label": "1か月未満",
        "val": 0
      },
      {
        "id": "m1",
        "label": "1〜3か月",
        "val": 1
      },
      {
        "id": "m3",
        "label": "3〜6か月",
        "val": 3
      },
      {
        "id": "m6",
        "label": "6〜12か月",
        "val": 6
      },
      {
        "id": "m12",
        "label": "12か月以上",
        "val": 12
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "か月分",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  },
  {
    "id": "q05",
    "s": "A",
    "text": "貯金の何か月分は手元に置いておきたい？",
    "field": "reserveMonths",
    "o": [
      {
        "id": "m3",
        "label": "3か月",
        "val": 3
      },
      {
        "id": "m6",
        "label": "6か月",
        "val": 6
      },
      {
        "id": "m12",
        "label": "12か月",
        "val": 12
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "か月分",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  },
  {
    "id": "q06",
    "s": "A",
    "text": "3年以内に大きな支出はある？",
    "field": "nearTermExpense",
    "o": [
      {
        "id": "none",
        "label": "ない",
        "val": 0
      },
      {
        "id": "has",
        "label": "ある",
        "input": {
          "unit": "万円",
          "mult": 10000,
          "label": "金額"
        }
      }
    ]
  },
  {
    "id": "q07",
    "s": "A",
    "text": "金融資産はいくら？",
    "note": "※貯金と投資の合計",
    "field": "financialAssets",
    "o": [
      {
        "id": "input",
        "label": "入力する",
        "input": {
          "unit": "万円",
          "mult": 10000
        }
      },
      {
        "id": "unknown",
        "label": "わからない",
        "val": null
      }
    ]
  },
  {
    "id": "q08",
    "s": "A",
    "text": "実際に投資している額は？",
    "field": "investedAmount",
    "o": [
      {
        "id": "not_yet",
        "label": "まだ投資していない",
        "val": null
      },
      {
        "id": "input",
        "label": "入力する",
        "input": {
          "unit": "万円",
          "mult": 10000
        }
      }
    ]
  },
  {
    "id": "q09",
    "s": "A",
    "text": "投資したお金は早ければいつ使う予定？",
    "o": [
      {
        "id": "y3to5",
        "label": "3〜5年以内"
      },
      {
        "id": "y5to10",
        "label": "5〜10年"
      },
      {
        "id": "y10plus",
        "label": "10年以上"
      },
      {
        "id": "undecided",
        "label": "決めていない"
      }
    ]
  },
  {
    "id": "q10",
    "s": "B",
    "text": "資産が減って夜も眠れない時がある？",
    "o": [
      {
        "id": "often",
        "label": "よくある"
      },
      {
        "id": "sometimes",
        "label": "ときどき"
      },
      {
        "id": "rarely",
        "label": "ほとんどない"
      },
      {
        "id": "no_drop_yet",
        "label": "まだ大きな下落を経験していない"
      }
    ]
  },
  {
    "id": "q11",
    "s": "B",
    "text": "投資額が何％減ったら辛いと感じそう？",
    "field": "tolerancePct",
    "o": [
      {
        "id": "p10",
        "label": "10%",
        "val": 10
      },
      {
        "id": "p20",
        "label": "20%",
        "val": 20
      },
      {
        "id": "p30",
        "label": "30%",
        "val": 30
      },
      {
        "id": "p40plus",
        "label": "40%以上",
        "val": 40
      },
      {
        "id": "unknown",
        "label": "わからない",
        "val": null
      }
    ]
  },
  {
    "id": "q12",
    "s": "B",
    "text": "下落で考えずに売ってしまったことは？",
    "o": [
      {
        "id": "no",
        "label": "ない"
      },
      {
        "id": "yes",
        "label": "ある"
      },
      {
        "id": "no_drop_yet",
        "label": "まだ大きな下落を経験していない"
      }
    ]
  },
  {
    "id": "q13",
    "s": "B",
    "text": "大きく下がった時、まず最初にすることは？",
    "o": [
      {
        "id": "wait",
        "label": "何もしないで待つ"
      },
      {
        "id": "buy_more",
        "label": "少しずつ買い増す"
      },
      {
        "id": "reduce",
        "label": "減らして様子を見る"
      },
      {
        "id": "unknown",
        "label": "わからない"
      }
    ]
  },
  {
    "id": "q14",
    "s": "C",
    "text": "上昇相場で浮かれて買って高値づかみしたことは？",
    "o": [
      {
        "id": "never",
        "label": "ない"
      },
      {
        "id": "once",
        "label": "一度ある"
      },
      {
        "id": "often",
        "label": "何度もある"
      },
      {
        "id": "no_rally_yet",
        "label": "まだ上昇相場を経験していない"
      }
    ]
  },
  {
    "id": "q15",
    "s": "C",
    "text": "持っている株が大きく上がった時、まず最初にすることは？",
    "o": [
      {
        "id": "hold",
        "label": "そのまま持つ"
      },
      {
        "id": "sell_some",
        "label": "一部を売る"
      },
      {
        "id": "buy_more",
        "label": "買い増す"
      },
      {
        "id": "undecided",
        "label": "決めていない"
      }
    ]
  },
  {
    "id": "q16",
    "s": "D",
    "text": "現在の投資スタイルは？",
    "o": [
      {
        "id": "steady",
        "label": "コツコツ増やす派"
      },
      {
        "id": "fast",
        "label": "一気に増やしたい派"
      },
      {
        "id": "defensive",
        "label": "守りを固めたい派"
      },
      {
        "id": "undecided",
        "label": "まだ決まっていない"
      }
    ]
  },
  {
    "id": "q17",
    "s": "D",
    "text": "どんなときに株を買うことが多い？",
    "o": [
      {
        "id": "monthly",
        "label": "毎月決まった日に"
      },
      {
        "id": "on_drop",
        "label": "下がったとき"
      },
      {
        "id": "on_rise",
        "label": "上がっているとき"
      },
      {
        "id": "news",
        "label": "ニュースや動画を見て"
      },
      {
        "id": "undecided",
        "label": "決めていない"
      }
    ]
  },
  {
    "id": "q18",
    "s": "D",
    "text": "株価はどのくらい見る？",
    "o": [
      {
        "id": "many_daily",
        "label": "毎日何度も"
      },
      {
        "id": "daily",
        "label": "毎日1回"
      },
      {
        "id": "weekly",
        "label": "週に数回"
      },
      {
        "id": "rarely",
        "label": "ほとんど見ない"
      }
    ]
  },
  {
    "id": "q19",
    "s": "D",
    "text": "SNSや動画の情報を見て勢いで買ったことは？",
    "o": [
      {
        "id": "never",
        "label": "ない"
      },
      {
        "id": "sometimes",
        "label": "ときどき"
      },
      {
        "id": "often",
        "label": "よくある"
      }
    ]
  },
  {
    "id": "q20",
    "s": "E",
    "text": "いまメインで投資しているのは？",
    "o": [
      {
        "id": "fund_etf",
        "label": "投資信託・ETF"
      },
      {
        "id": "stock",
        "label": "個別株"
      },
      {
        "id": "bond",
        "label": "債券"
      },
      {
        "id": "gold",
        "label": "金"
      },
      {
        "id": "mixed",
        "label": "複数に分けている"
      }
    ]
  },
  {
    "id": "q21",
    "s": "E",
    "multi": true,
    "text": "どのセクターが多い？",
    "note": "※複数選択可",
    "o": [
      {
        "id": "tech_semis",
        "label": "ハイテク・半導体"
      },
      {
        "id": "dividend",
        "label": "高配当"
      },
      {
        "id": "healthcare",
        "label": "ヘルスケア"
      },
      {
        "id": "finance",
        "label": "金融"
      },
      {
        "id": "energy_materials",
        "label": "エネルギー・素材"
      },
      {
        "id": "other",
        "label": "その他"
      }
    ]
  },
  {
    "id": "q22",
    "s": "E",
    "text": "1銘柄に入れるのは、投資額の何%まで？",
    "field": "perStockCapPct",
    "o": [
      {
        "id": "p10",
        "label": "10%",
        "val": 10
      },
      {
        "id": "p20",
        "label": "20%",
        "val": 20
      },
      {
        "id": "p30",
        "label": "30%",
        "val": 30
      },
      {
        "id": "p50",
        "label": "50%",
        "val": 50
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "%",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  },
  {
    "id": "q23",
    "s": "E",
    "text": "いま一番多く持っている銘柄の割合は？",
    "o": [
      {
        "id": "lt10",
        "label": "〜10%"
      },
      {
        "id": "p10to30",
        "label": "10〜30%"
      },
      {
        "id": "p30to50",
        "label": "30〜50%"
      },
      {
        "id": "gt50",
        "label": "50%超"
      },
      {
        "id": "none",
        "label": "まだ持っていない"
      }
    ]
  },
  {
    "id": "q24",
    "s": "F",
    "text": "買い増しは何段階に分ける？",
    "o": [
      {
        "id": "none",
        "label": "買い増しはしない"
      },
      {
        "id": "single",
        "label": "分けない(1回で)"
      },
      {
        "id": "steps2",
        "label": "2段階"
      },
      {
        "id": "steps3",
        "label": "3段階"
      },
      {
        "id": "steps4",
        "label": "4段階"
      }
    ]
  },
  {
    "id": "q25",
    "s": "F",
    "text": "1段階目は、何%下がったら？",
    "field": "firstDropPct",
    "o": [
      {
        "id": "d5",
        "label": "−5%",
        "val": 5
      },
      {
        "id": "d10",
        "label": "−10%",
        "val": 10
      },
      {
        "id": "d15",
        "label": "−15%",
        "val": 15
      },
      {
        "id": "d20",
        "label": "−20%",
        "val": 20
      },
      {
        "id": "unknown",
        "label": "わからない",
        "val": null
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "%",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  },
  {
    "id": "q26",
    "s": "F",
    "text": "買い増し用に置いておく現金は投資額の何%？",
    "field": "buyBudgetPct",
    "o": [
      {
        "id": "b5",
        "label": "5%",
        "val": 5
      },
      {
        "id": "b10",
        "label": "10%",
        "val": 10
      },
      {
        "id": "b20",
        "label": "20%",
        "val": 20
      },
      {
        "id": "b30",
        "label": "30%",
        "val": 30
      },
      {
        "id": "custom",
        "label": "入力する",
        "input": {
          "unit": "%",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  },
  {
    "id": "q27",
    "s": "F",
    "text": "買い増し金額の配分は？",
    "o": [
      {
        "id": "equal",
        "label": "毎回同じ"
      },
      {
        "id": "heavier",
        "label": "下がるほど多め"
      }
    ]
  },
  {
    "id": "q28",
    "s": "G",
    "multi": true,
    "free": "noBuyConditions",
    "text": "買わない条件は？",
    "note": "※複数選択可",
    "o": [
      {
        "id": "cash_low",
        "label": "貯金が減ったとき"
      },
      {
        "id": "income_unstable",
        "label": "収入が不安定なとき"
      },
      {
        "id": "over_cap",
        "label": "1銘柄が上限を超えているとき"
      },
      {
        "id": "no_reason",
        "label": "買う理由を説明できないとき"
      }
    ]
  },
  {
    "id": "q29",
    "s": "G",
    "multi": true,
    "free": "haltConditions",
    "text": "いったん手を止める条件は？",
    "note": "※複数選択可",
    "o": [
      {
        "id": "over_tolerance",
        "label": "許容できる下落額を超えたとき"
      },
      {
        "id": "cant_sleep",
        "label": "眠れないほど不安なとき"
      },
      {
        "id": "thesis_broken",
        "label": "買った理由が崩れたとき"
      }
    ]
  },
  {
    "id": "q30",
    "s": "H",
    "text": "ドル円が動いたら、どう行動する？",
    "field": "thresholdYen",
    "o": [
      {
        "id": "ignore",
        "label": "特に動かない",
        "val": null
      },
      {
        "id": "yen3",
        "label": "±3円動いたらルールを読み直す",
        "val": 3
      },
      {
        "id": "yen7",
        "label": "±7円動いたらルールを読み直す",
        "val": 7
      },
      {
        "id": "custom",
        "label": "自分で数字を入れる",
        "input": {
          "unit": "円動いたら",
          "mult": 1,
          "step": 0.1
        }
      }
    ]
  }
] as const;
