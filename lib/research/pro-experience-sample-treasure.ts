/** トレジャーハント's sample in the PRO feature tour (owner, Nov 22): one fixed day, checked by the page's own parser so the sample can
 * never show something the real page would refuse. Pure: no network, no storage. */
import { parseValueSnapshot } from "./value-check.ts";
import file from "./pro-experience-samples/treasure-hunt.json" with { type: "json" };

export const treasureHuntSample = parseValueSnapshot(file);
