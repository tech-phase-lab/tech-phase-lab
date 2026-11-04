import { isGenericPulseLabel } from "./news-pulse-headline.ts";

/** The home news band shows one short headline per story: about 20 Japanese characters, 22 at most (owner, Nov 4). */
export const BAND_MAX_JA = 22;
export const BAND_MAX_EN = 48;
const JAPANESE = /[぀-ヿ㐀-鿿]/;

/** The short headline of a story, or "" when it has none. A headline that is too long is never cut: the story is left out of the band
 * (it stays in the news list). The ending "。" is dropped, since the band is not a full sentence. */
export function bandTitle(candidates: readonly (string | undefined | null)[], ja: boolean) {
  const max = ja ? BAND_MAX_JA : BAND_MAX_EN;
  for (const candidate of candidates) {
    const text = candidate?.trim().replace(/[。.]$/, "").trim();
    if (!text || /[\r\n]/.test(text) || Array.from(text).length > max || isGenericPulseLabel(text) || (ja && !JAPANESE.test(text))) continue;
    return text;
  }
  return "";
}

const sameStory = (text: string) => text.normalize("NFKC").replace(/[\s、。,.:：・·「」『』"'’“”-]/g, "").toLowerCase();

/** Stories that have a short headline, newest first, with the same headline never shown twice. */
export function bandItems<T extends { headlines: readonly string[]; title: string }>(items: readonly T[], ja: boolean, limit = 5) {
  const seen = new Set<string>();
  const shown: (T & { band: string })[] = [];
  for (const item of items) {
    const band = bandTitle([...item.headlines, item.title], ja);
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
