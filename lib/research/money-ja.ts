/** Money units in Japanese copy (owner, Nov 18): every dollar amount in Japanese units (1,158億ドル, 4.82億ドル, 1,250万ドル), never
 * "$130.0 billion" or a bare "$115.8" whose scale was lost. The same rule as scripts/research/deep_analysis.py (money_units), applied
 * again where the copy is read so analyses stored before it are shown the same way. Exact decimal arithmetic on the digits; no floats. */
const SCALE_EXP: Record<string, number> = { trillion: 12, t: 12, billion: 9, b: 9, bn: 9, million: 6, m: 6, mn: 6, thousand: 3, k: 3 };
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const SCALE = String.raw`(?:trillion|billion|million|thousand|bn|mn|[TBMK])(?![A-Za-z])`;
const RANGE = new RegExp(String.raw`(?<![\d.,])\$?\s*(${AMOUNT})\s*(?:[–—~〜～]|-(?=\s*\$?\d)|to)\s*\$?\s*(${AMOUNT})\s*(${SCALE})\s*(?:米?ドル|USD|dollars?)?`, "gi");
const SCALED = new RegExp(String.raw`(?<![\d.,])(?:US)?\$\s*(${AMOUNT})\s*(${SCALE})\s*(?:米?ドル)?|(?<![\d.,$])(${AMOUNT})\s*(${SCALE})\s*(?:米?ドル|USD|dollars?)`, "gi");
const BARE = () => new RegExp(String.raw`(?<![A-Za-z0-9.])(?:US)?\$\s*(${AMOUNT})(?!\d)(?![.,]\d)(?!\s*(?:${SCALE}|兆|億|万|千))(?!\s*(?:[–—~〜～-]|to)\s*\$?\s*(?:${AMOUNT})\s*${SCALE})`, "gi");
const PER_SHARE = /1株|株当たり|EPS|配当|株価|per[- ]share|dividend|share price/i;
const ENGLISH_SCALE = /(?:trillion|billion|million|thousand)|\d\s*(?:bn|mn|[BM])(?![A-Za-z])/i;

/** "115.8" × 10^9 ÷ 10^8 → "1,158" (digits shifted, trailing zeros dropped, thousands grouped). */
function shift(amount: string, by: number): string {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  let digits = whole + fraction, point = whole.length + by;
  if (point < 0) { digits = "0".repeat(-point) + digits; point = 0; }
  if (point > digits.length) digits += "0".repeat(point - digits.length);
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0", frac = digits.slice(point).replace(/0+$/, "");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}
/** The power of ten of the amount's leading digit (enough to pick the unit). */
function magnitude(amount: string, exp: number): number {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  const first = (whole + fraction).search(/[1-9]/);
  return first < 0 ? -Infinity : whole.length - 1 - first + exp;
}
export function yenStyle(amount: string, exp: number): string {
  for (const [unit, power] of [["兆", 12], ["億", 8], ["万", 4]] as const) if (magnitude(amount, exp) >= power) return `${shift(amount, exp - power)}${unit}ドル`;
  return `${shift(amount, exp)}ドル`;
}
const exp = (word: string) => SCALE_EXP[word.toLowerCase()];

/** Japanese copy with every scaled dollar amount in Japanese units; a per-share "$2.70" becomes "2.70ドル". */
export function japaneseMoney(text: string): string {
  let out = text.replace(RANGE, (_, low: string, high: string, word: string) => `${yenStyle(low, exp(word)).slice(0, -2)}〜${yenStyle(high, exp(word))}`);
  out = out.replace(SCALED, (_, a1?: string, w1?: string, a2?: string, w2?: string) => yenStyle((a1 ?? a2)!, exp((w1 ?? w2)!)));
  if (PER_SHARE.test(out)) out = out.replace(BARE(), (_, amount: string) => `${amount}ドル`);
  return out.replace(/プラスマイナス/g, "±");
}

/** The pair with the Japanese amounts converted, or null when a dollar amount has lost its scale (either language) or the Japanese
 * still carries an English scale word: that part is not shown. */
export function withJapaneseMoney<T extends { ja: string; en: string }>(copy: T): T | null {
  for (const text of [copy.ja, copy.en]) if (BARE().test(text) && !PER_SHARE.test(text)) return null;
  const ja = japaneseMoney(copy.ja);
  if (ENGLISH_SCALE.test(ja) || ja.includes("$")) return null;
  return { ...copy, ja };
}
