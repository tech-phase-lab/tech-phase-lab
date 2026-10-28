const JOINER = "⁠";

/** Display clean-up for Japanese headlines (owner, Oct 18): no "、" right after a closing bracket, and a company
 * name with its ticker, "アルファベット（GOOGL）", is never split across lines. Safe to apply twice. */
export function tidyJapanese(text: string): string {
  if (!/[぀-ヿ㐀-鿿]/.test(text)) return text;
  const plain = text.replaceAll(JOINER, "").replace(/）、/g, "）");
  // A long name keeps only its last six characters bound to the ticker; binding a truncated tail left the front
  // two characters alone on a line ("ルメ" / "ンタム・ホールディングス（LITE）", owner, Oct 22).
  return plain.replace(/([ァ-ヶー・一-龠々]+)（([A-Za-z0-9.\-]{1,6})）/g, (_unit, name: string, ticker: string) => {
    const chars = [...name], free = chars.length > 12 ? chars.length - 6 : 0;
    return chars.slice(0, free).join("") + [...chars.slice(free).join("") + `（${ticker}）`].join(JOINER);
  });
}
