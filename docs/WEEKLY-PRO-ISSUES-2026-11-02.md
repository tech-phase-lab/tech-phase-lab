# 週刊 Tech Phase PRO — 号のデータ契約(2026-11-02)

自動作成(ChatGPT側)は、監視サービスに下書きを書き込む。画面・保存・公開はこちら側。

## 書き込み(運営者トークン)
`POST {RESEARCH_MONITOR_URL}/admin/weekly/draft`  / `Authorization: Bearer <RESEARCH_EDITOR_TOKEN>` / JSON 256KBまで。
生成側は必ず `"auto": true` を付ける。運営者の画面からの編集は常に `auto:false` になる。
「確認なしで自動公開」がオンのときだけ、`auto:true` の下書きがその場で公開される(初期値はオフ)。

```json
{ "date": "2026-10-01", "headline": "…(120字まで)", "lead": "…(400字まで)", "auto": true,
  "notes": ["数字が食い違った: …", "ここは取れませんでした: …"],
  "sources": [{ "title": "Micron", "url": "https://…" }],
  "parts": [ … 12個まで、順番どおりに表示 ] }
```
- `notes`: 運営者だけに見える注意書き。読者には出ない。
- `sources`: https のみ。画面の最後に閉じた「出典」で出る。
- 号の番号は公開のときに付く(次の番号 = 最大+1)。

## parts の種類(これ以外と余計な項目は拒否される)
| type | 項目 |
|---|---|
| `text` | `heading`, `body` |
| `numbers` | `heading`, `cards[]`, `note` |
| `timeline` | `heading`, `points[]`: `when`, `event`, `comment?`, `tone` = up/down/flat |
| `schedule` | `heading`, `items[]`: `date`(YYYY-MM-DD), `name`, `comment?` |
| `chart` | `heading`, `title?`, `unit?`, `bars[]`: `label`, `value`(0以上), `note?` |
| `highlight` | `text`(見出しなし。大きな1文) |

`numbers.cards[]`: `label`, `value?`, `outlook?`, `previous?`, `unit?`, `outlookUnit?`, `range?`, `delta?`(`pct`/`pt`)。`value`と`outlook`のどちらかは必須。
バッジは画面側で計算する(見通し÷今回、なければ今回÷前回)。単位が `%` か `delta:"pt"` なら「pt」(例 −0.75pt)、それ以外は「%」(例 +13.4%)。

## 読み出し・操作
- 読者(PRO): `GET /api/research/weekly-issues?number=&before=&limit=`(公開済みだけ)
- 運営者: 同 `?view=owner` で下書きと設定。`POST` の `action` = `draft` / `publish` / `delete` / `settings`。
- 通知: 運営者の通知設定「週刊の下書き」(初期値オフ)。本文は通知に出ない。
- 以前の週刊(自由文の投稿)は、この新しい画面には出ない。


## 自動作成(11/4 追加。監視サービスの中で動く。ChatGPT側は使わない)
`scripts/research/weekly_generator.py`。毎週土曜の朝(初期は8時・日本時間、運営者の画面で変えられる)に、その週に集めて検証済みの材料から、下書きを1つ作る。**初期値はオフ**(運営者が画面でオンにするまで動かない)。

- **材料**: 今週(過去7日)の指標の結果・決算の数字(`market_result_publications`)、公式発表の記事(`official_research_publications`)、サイトが出している見出し、次週の予定(`release_schedule.json`)。
- **数字のルール**: AIは文章だけを書く。数字カード・棒グラフの値と単位はプログラムが検証済みの値から作り、増減の%・ptは画面が計算する。文章の中の数字は、その文が引いた資料にあるものだけ(PRO深い分析と同じ検査)。通らない部品は外し、下書きに「数字が食い違った: …」と残す。取れなかった項目は「ここは取れませんでした: …」と残し、ほかは作り続ける。
- **次週の予定**は毎回、プログラムが入れる(AIは一言だけ。数字は入れられない)。
- **失敗**: 30分あけて最大3回まで。1週に1号。号は必ず下書きで、「確認なしで自動公開」がオンのときだけすぐ公開される。
- **使う設定**: `OPENAI_API_KEY` と、`WEEKLY_MODEL`(なければ `RESEARCH_DEEP_MODEL`)。どちらも未設定なら、画面に「AIの設定がまだ終わっていません」と出て、作らない。
- **運営者の画面**: 「毎週土曜に下書きを自動で作る」のスイッチ、作る時刻、「今すぐ下書きを作る」(試し用。週の記録にはならない)。
- **API**: `POST /admin/weekly/generate`(運営者トークン。背景で始めて202を返す)、`GET /admin/weekly` の `generation`(running・configured・lastOk・lastError)。

### いまの限界
- 日付だけのイベント(FOMC会合最終日・米中間選挙など)は、次週の予定にまだ入らない(`release_schedule.json` にないため)。
- 一般ニュースは、サイトが出している見出しだけ(Stock News API の契約後に、ここへ足す)。
- 本物のAIでの1号は、運営者が「今すぐ下書きを作る」を押すまで未確認。
