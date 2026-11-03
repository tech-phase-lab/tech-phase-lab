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
