import { isGenericPulseLabel } from "./news-pulse-headline.ts";
import { japaneseNamesOf } from "./stock-search.ts";

/** The home news band shows one short headline per story: about 20 Japanese characters, 22 at most (owner, Nov 4); 24 since Nov 5 ("a little more": the 12.5px minimum size fits about 24 on a phone). */
export const BAND_MAX_JA = 24;
export const BAND_MAX_EN = 48;
/** On a wide screen (a computer) the band has room for the fuller headline (owner, Nov 12: it may be long there). */
export const BAND_WIDE_MAX_JA = 64;
export const BAND_WIDE_MAX_EN = 120;
const JAPANESE = /[぀-ヿ㐀-鿿]/;

/** The short headline of a story, or "" when it has none. A headline that is too long is never cut: the story is left out of the band
 * (it stays in the news list). The ending "。" is dropped, since the band is not a full sentence. */
export function bandTitle(candidates: readonly (string | undefined | null)[], ja: boolean, wide = false) {
  const max = wide ? (ja ? BAND_WIDE_MAX_JA : BAND_WIDE_MAX_EN) : ja ? BAND_MAX_JA : BAND_MAX_EN;
  for (const candidate of candidates) {
    const text = candidate?.trim().replace(/[。.]$/, "").trim();
    if (!text || /[\r\n]/.test(text) || Array.from(text).length > max || isGenericPulseLabel(text) || (ja && !JAPANESE.test(text))) continue;
    return text;
  }
  return "";
}

const sameStory = (text: string) => text.normalize("NFKC").replace(/[\s、。,.:：・·「」『』"'’“”-]/g, "").toLowerCase();

/** Stories that have a short headline, newest first, with the same headline never shown twice. */
export function bandItems<T extends { headlines: readonly string[]; title: string }>(items: readonly T[], ja: boolean, limit = 5, wide = false) {
  const seen = new Set<string>();
  const shown: (T & { band: string })[] = [];
  for (const item of items) {
    // Wide: the full headline first (it names more), the short one when the full one is too long even there.
    const band = bandTitle(wide ? [item.title, ...item.headlines] : [...item.headlines, item.title], ja, wide);
    const key = sameStory(band);
    if (!band || seen.has(key)) continue;
    seen.add(key);
    shown.push({ ...item, band });
    if (shown.length >= limit) break;
  }
  return shown;
}

/** Split a band headline so each stock symbol (APH, MU ...) can be drawn in bold white monospace. */
export function bandParts(text: string, symbols: readonly string[]) {
  const known = new Set(symbols.map(value => value.toUpperCase()));
  return text.split(/(?<![A-Za-z0-9.])([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9])/).map((part, index) => ({ text: part, symbol: index % 2 === 1 && known.has(part) }));
}

/** The symbols of the companies a story is about that its short headline does not name, so the band can show them in front and a reader
 * always knows whose story it is ("エヌビディアは強い四半期期待" names its company; "警察と活動家が衝突" names none). Market-wide items (MKT) get none. */
export function bandLead(ticker: string, band: string, namesOf: (symbol: string) => readonly string[] = japaneseNamesOf) {
  const upper = band.toUpperCase();
  return ticker.split(/[\s·,]+/)
    .filter(part => /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(part) && part !== "MKT" && !upper.includes(part) && !namesOf(part).some(name => band.includes(name)))
    .slice(0, 2).join(" ");
}
