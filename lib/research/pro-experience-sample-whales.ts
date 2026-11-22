/** クジラの足あと's sample in the PRO feature tour (owner, Nov 22): all four tabs at one fixed moment, checked by the page's own parser so
 * the sample can never show something the real page would refuse. Pure: no network, no storage. */
import { parseWhaleSnapshot } from "./whale-moves.ts";
import file from "./pro-experience-samples/whale-tracks.json" with { type: "json" };

export const whaleTracksSample = parseWhaleSnapshot(file);
