// Substitute questions (owner, Nov 25: the diagnosis is always 30 questions). Each one is asked in place of `replaces`
// when that question is skipped, so the count never changes. Kept apart from diagnosis-questions-ja.ts, whose wording is
// fixed by the legal review.
export const SUBSTITUTE_QUESTIONS_JA = [
  {
    "replaces": "q21",
    "id": "q21alt",
    "s": "E",
    "multi": true,
    "text": "どんな商品が多い？",
    "note": "※複数選択可",
    "o": [
      { "id": "index", "label": "全世界・米国のインデックス" },
      { "id": "high_dividend", "label": "高配当ETF" },
      { "id": "bond", "label": "債券" },
      { "id": "gold", "label": "金" },
      { "id": "theme", "label": "半導体などのテーマ型" },
      { "id": "other", "label": "その他" }
    ]
  },
  {
    "replaces": "q25",
    "id": "q25alt",
    "s": "F",
    "text": "下落中も積み立ては続ける？",
    "o": [
      { "id": "continue", "label": "続ける" },
      { "id": "pause", "label": "いったん止める" },
      { "id": "no_plan", "label": "積み立てはしていない" }
    ]
  },
  {
    "replaces": "q26",
    "id": "q26alt",
    "s": "F",
    "text": "大きく上がったとき利益を確定する目安は？",
    "o": [
      { "id": "p20", "label": "+20%" },
      { "id": "p30", "label": "+30%" },
      { "id": "p50", "label": "+50%" },
      { "id": "undecided", "label": "決めていない" }
    ]
  },
  {
    "replaces": "q27",
    "id": "q27alt",
    "s": "F",
    "text": "売ることを考えるのは何%下がったとき？",
    "o": [
      { "id": "d20", "label": "−20%" },
      { "id": "d30", "label": "−30%" },
      { "id": "d50", "label": "−50%" },
      { "id": "never", "label": "売らない" }
    ]
  }
] as const;
