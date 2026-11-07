/** Keeps a number together with its unit when a Japanese line wraps ("日本時間4日" must not break between 4 and 日; owner, Nov 6).
 * A word joiner (U+2060) is invisible and only forbids a line break at that spot. */
export const noBreakUnits = (text: string) => text.replace(/(\d)(?=[日月年時分秒%％件社人円ドル])/g, "$1⁠");
