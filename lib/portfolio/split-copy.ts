import type { Ambiguous, Reading, Split } from "./splits.ts";

/** Wording of the stock-split notices on the portfolio screen (owner, Nov 21). Japanese uses 「ドル」, never "$" or "8-for-1". Pure. */
const trim = (n: number) => String(Number(n.toFixed(4)));
/** 8 → [1, 8]; 0.125 → [8, 1]; 1.5 → [2, 3]: old shares and new shares, smallest whole numbers. */
export function shareCounts(ratio: number): [number, number] {
  for (let old = 1; old <= 50; old++) {
    const fresh = ratio * old;
    if (Math.abs(fresh - Math.round(fresh)) < 1e-6 && Math.round(fresh) >= 1) return [old, Math.round(fresh)];
  }
  return [1, Number(trim(ratio))];
}
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
/** 「1株が8株に分割されました」 / 「8株が1株に併合されました」 (and the English). */
export function splitPhrase(split: Split, ja: boolean): string {
  const [from, to] = shareCounts(split.ratio);
  if (ja) return `${from}株が${to}株に${to > from ? "分割" : "併合"}されました`;
  return to > from ? `${from === 1 ? "each share" : `every ${from} shares`} became ${to} shares` : `every ${from} shares became ${to === 1 ? "1 share" : `${to} shares`}`;
}
/** One sentence per split: 「SNDK は 11/20 に、1株が8株に分割されました。」 */
export function splitSentences(items: readonly Ambiguous[], ja: boolean): string[] {
  const seen = new Map<string, Split>();
  for (const item of items) for (const split of item.splits) seen.set(`${split.ticker}|${split.date}`, split);
  return [...seen.values()].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date))
    .map(s => ja ? `${s.ticker} は ${md(s.date)} に、${splitPhrase(s, true)}。` : `On ${md(s.date)}, ${s.ticker} split: ${splitPhrase(s, false)}.`);
}
/** "×8" as words: 「8倍にする」, 「8分の1にする」. */
function times(factor: number, ja: boolean): string {
  if (factor >= 1) return ja ? `${trim(factor)}倍にする` : `×${trim(factor)}`;
  return ja ? `${trim(1 / factor)}分の1にする` : `÷${trim(1 / factor)}`;
}
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 4 });
/** One button: 「80株・平均取得 94.00ドル（登録したまま）」 */
export function readingLabel(reading: Reading, ja: boolean): string { return readingParts(reading, ja).join(""); }
/** The button in two parts (numbers, then the reading in brackets) so a phone can put the bracket on its own line. */
export function readingParts(reading: Reading, ja: boolean): [string, string] {
  const what = reading.kind === "as-stored" ? (ja ? "登録したまま" : "as registered")
    : reading.kind === "pre-split" ? (ja ? `分割前の数字として${times(reading.factor, true)}` : `pre-split numbers, ${times(reading.factor, false)}`)
    // The old screen applied the split the wrong way round: it divided by the ratio (an 8-for-1 gave 1/8) — the fix is ratio².
    : (ja ? `誤って${times(1 / Math.sqrt(reading.factor), true).replace(/にする$/, "")}になった数字を直す` : `undo the wrong ${times(1 / Math.sqrt(reading.factor), false)}`);
  return ja ? [`${count(reading.shares)}株・平均取得 ${money(reading.avgCostUsd)}ドル`, `（${what}）`] : [`${count(reading.shares)} shares · avg. cost $${money(reading.avgCostUsd)}`, ` (${what})`];
}
/** The lot's title: 「SNDK（楽天証券）」 */
export const lotTitle = (item: Ambiguous, ja: boolean) => item.source ? (ja ? `${item.ticker}（${item.source}）` : `${item.ticker} (${item.source})`) : item.ticker;
/** The note for lots this screen brought across a recent split. */
export function adjustedNote(splits: readonly Split[], ja: boolean): string {
  const list = splits.map(s => ja ? `${s.ticker}（${md(s.date)} に${splitPhrase(s, true).replace(/されました$/, "")}）` : `${s.ticker} (${md(s.date)}: ${splitPhrase(s, false)})`);
  return ja ? `${list.join("・")}より前に登録した株数と平均取得は、分割後の数字で表示しています。取得額の合計は変わりません。`
    : `Shares and average cost registered before the split of ${list.join(", ")} are shown on the post-split basis. The total cost is unchanged.`;
}
