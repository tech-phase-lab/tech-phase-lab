/** クジラの足あと's sample in the PRO feature tour (owner, Nov 22): all four tabs at one fixed moment, checked by the page's own parser so
 * the sample can never show something the real page would refuse. Pure: no network, no storage. */
import { parseWhaleSnapshot } from "./whale-moves.ts";
import file from "./pro-experience-samples/whale-tracks.json" with { type: "json" };

export const whaleTracksSample = parseWhaleSnapshot(file);
/** The gold line under the sample, like トレジャーハント's (owner, Nov 23): the sample shows five rows a tab, the real page the ownership
 * universe of scripts/research/ownership_data.py (Value Check ハイテク plus the 22 watched companies, 157 stocks on Nov 23). */
export const WHALE_NOTE = { ja: "※実際は約150銘柄のデータを見られます", en: "*The full version covers about 150 stocks" } as const;
