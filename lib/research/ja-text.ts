const JOINER = "⁠";

/** Display clean-up for Japanese headlines (owner, Oct 18): no "、" right after a closing bracket, and a company
 * name with its ticker, "アルファベット（GOOGL）", is never split across lines. Safe to apply twice. */
export function tidyJapanese(text: string): string {
  if (!/[぀-ヿ㐀-鿿]/.test(text)) return text;
  const plain = text.replaceAll(JOINER, "").replace(/）、/g, "）");
  return plain.replace(/[ァ-ヶー・一-龠々]{1,12}（[A-Za-z0-9.\-]{1,6}）/g, unit => [...unit].join(JOINER));
}
