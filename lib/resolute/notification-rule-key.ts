import { createHash } from "node:crypto";
import type { NotificationSettings } from "./notification-settings.ts";
import type { PlanInput } from "./plan-data.ts";

/** A new reference price or set of thresholds is a new rule; a delivery-hour change or a price day is not. The stored price is hashed
 * exactly as stored, without its price day, so every existing row keeps its key at deploy. A stock split never changes the stored price
 * (it is converted only when read, and a screen that sends the converted price back unchanged keeps the stored original:
 * keepStoredOriginals in notification-splits.ts), so a split never changes the key either. */
export function notificationRuleKey(settings:NotificationSettings,plan:PlanInput|null) {
 const items=settings.watchItems.map(i=>({symbol:i.symbol,referencePrice:i.referencePrice}));
 return createHash("sha256").update(JSON.stringify({items,lines:plan?.buyLines.map(l=>l.dropPct)??[],surge:settings.surgeCapPct})).digest("hex");
}
