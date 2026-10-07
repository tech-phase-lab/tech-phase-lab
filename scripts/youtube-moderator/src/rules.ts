/**
 * NGワードの判定。AI を通さず文字一致で確実に弾く。
 * 全角・半角、カタカナ・ひらがな、空白や記号の挟み込み（「ゼ ウ ス」「ド・ル箱」など）の違いは吸収する。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export function findNgWord(text: string, ngWords: string[]): string | undefined {
  const normalized = normalizeForMatch(text);
  return ngWords.find((word) => {
    const target = normalizeForMatch(word);
    return target.length > 0 && normalized.includes(target);
  });
}
