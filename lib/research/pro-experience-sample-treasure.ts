/** トレジャーハント's sample in the PRO feature tour (owner, Nov 22): one fixed day, checked by the page's own parser so the sample can
 * never show something the real page would refuse. Pure: no network, no storage. */
import { parseValueSnapshot } from "./value-check.ts";
import file from "./pro-experience-samples/treasure-hunt.json" with { type: "json" };

export const treasureHuntSample = parseValueSnapshot(file);
/** The gold line in place of すべて見る (owner's mockup 01): the sample shows seven stocks, the real ranking about 150 / 500. */
export const TREASURE_NOTE = {
  tech: { ja: "※実際は約150銘柄のランキングです", en: "*The full ranking covers about 150 stocks" },
  all: { ja: "※実際は約500銘柄のランキングです", en: "*The full ranking covers about 500 stocks" },
} as const;
