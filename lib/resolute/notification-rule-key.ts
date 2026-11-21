import { createHash } from "node:crypto";
import type { NotificationSettings } from "./notification-settings.ts";
import type { PlanInput } from "./plan-data.ts";
import { etDay, isDay, mergeSplits, splitFactor } from "../research/stock-splits.ts";

/** The day reference prices are expressed on inside the rule key: before any split this change handles (SNDK 2026-11-20). A price saved
 * on another basis is converted to it with the manual split list (lib/research/stock-splits.json; deterministic, no I/O, so the alert job
 * and the sender always agree). An unchanged price with no split in between hashes exactly as before priceDay existed, so deploying this
 * resets no one's notified lines, and converting a price across a split (700 on 11/18 → 87.50 on 11/24) keeps the same key. */
export const RULE_PRICE_BASIS = "2026-11-01";
function rulePrice(price: number, symbol: string, day: string): number {
  const splits = mergeSplits(symbol, []);
  const factor = day >= RULE_PRICE_BASIS ? splitFactor(splits, RULE_PRICE_BASIS, day) : 1 / splitFactor(splits, day, RULE_PRICE_BASIS);
  // A converted price was rounded to cents; × ratio it is compared at 0.1 precision (755 → 94.38 → 755.04 → 755).
  return factor === 1 ? price : Math.round(price * factor * 10) / 10;
}

/** A new reference price or set of thresholds is a new rule; a delivery-hour change, a price day or a split conversion is not. `savedAt`
 * (the row's updated_at) is the day of items saved without a price day. */
export function notificationRuleKey(settings:NotificationSettings,plan:PlanInput|null,savedAt?:Date|string|null) {
 const legacy=savedAt?etDay(savedAt):RULE_PRICE_BASIS;
 const items=settings.watchItems.map(i=>({symbol:i.symbol,referencePrice:rulePrice(i.referencePrice,i.symbol,i.priceDay&&isDay(i.priceDay)?i.priceDay:legacy||RULE_PRICE_BASIS)}));
 return createHash("sha256").update(JSON.stringify({items,lines:plan?.buyLines.map(l=>l.dropPct)??[],surge:settings.surgeCapPct})).digest("hex");
}
