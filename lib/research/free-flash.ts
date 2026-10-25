import { flashInstant, type FlashRow } from "./flash-rows.ts";

/** What a FREE visitor sees on the 速報 page (owner decision, Oct 25): 30 minutes behind, the latest five, headlines only.
 * PRO members and the owner account see everything at once, with summaries. Applies to the 速報 page alone. */
export const FREE_FLASH_DELAY_MS = 30 * 60_000;
export const FREE_FLASH_LIMIT = 5;

export function freeFlashRows(rows: readonly FlashRow[], now = Date.now()): FlashRow[] {
  const cutoff = now - FREE_FLASH_DELAY_MS;
  return rows
    .filter(row => flashInstant(row) <= cutoff)
    .sort((a, b) => flashInstant(b) - flashInstant(a) || a.id.localeCompare(b.id))
    .slice(0, FREE_FLASH_LIMIT)
    // Headline only: no summary, no linked text.
    .map(({ body: _body, url: _url, ...row }) => row);
}
