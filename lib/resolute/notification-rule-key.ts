import { createHash } from "node:crypto";
import type { NotificationSettings } from "./notification-settings.ts";
import type { PlanInput } from "./plan-data.ts";

export function notificationRuleKey(settings:NotificationSettings,plan:PlanInput|null) {
 return createHash("sha256").update(JSON.stringify({items:settings.watchItems,lines:plan?.buyLines.map(l=>l.dropPct)??[],surge:settings.surgeCapPct})).digest("hex");
}
