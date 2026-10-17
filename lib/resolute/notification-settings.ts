export const DELIVERY_HOURS = [7, 8, 9, 10] as const;
export type DeliveryHour = typeof DELIVERY_HOURS[number];
export type NotificationSettings = {
 deliveryHourJst: DeliveryHour;
 alertsEnabled: boolean;
 morningEnabled: boolean;
 watchItems: { symbol: string; referencePrice: number }[];
 surgeCapPct: number | null;
};
export type NotificationSnapshot = { settings: NotificationSettings; revision: number };
export const defaultNotificationSettings = (): NotificationSettings => ({
 deliveryHourJst: 7, alertsEnabled: false, morningEnabled: false, watchItems: [], surgeCapPct: null,
});
export class NotificationInputError extends Error {
 constructor() { super("INVALID_NOTIFICATION_SETTINGS"); }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
 if (!value || typeof value !== "object" || Array.isArray(value) ||
  Object.keys(value).length !== keys.length || keys.some(k=>!Object.hasOwn(value,k))) throw new NotificationInputError();
 return value as Record<string, unknown>;
}
function decimal(n: unknown, min: number, max: number, precision: number): n is number {
 return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max &&
  Math.abs(Math.round(n*precision)/precision-n)<1e-9;
}
export function parseNotificationSettings(value: unknown): NotificationSettings {
 const s=object(value,["deliveryHourJst","alertsEnabled","morningEnabled","watchItems","surgeCapPct"]);
 if (!DELIVERY_HOURS.includes(s.deliveryHourJst as DeliveryHour) || typeof s.alertsEnabled!=="boolean" ||
  typeof s.morningEnabled!=="boolean" || !Array.isArray(s.watchItems) || s.watchItems.length>5 ||
  (s.surgeCapPct!==null && !decimal(s.surgeCapPct,0.1,1000,10))) throw new NotificationInputError();
 const symbols=new Set<string>();
 const watchItems=s.watchItems.map(v=>{
  const i=object(v,["symbol","referencePrice"]);
  if(typeof i.symbol!=="string" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(i.symbol) || symbols.has(i.symbol) ||
   !decimal(i.referencePrice,0.01,1000000,100)) throw new NotificationInputError();
  symbols.add(i.symbol); return {symbol:i.symbol,referencePrice:i.referencePrice};
 });
 if(s.alertsEnabled && !watchItems.length) throw new NotificationInputError();
 return {deliveryHourJst:s.deliveryHourJst as DeliveryHour,alertsEnabled:s.alertsEnabled,
  morningEnabled:s.morningEnabled,watchItems,surgeCapPct:s.surgeCapPct as number|null};
}
export function parseNotificationMutation(value: unknown) {
 const v=object(value,["settings","baseRevision"]);
 if(!Number.isSafeInteger(v.baseRevision) || (v.baseRevision as number)<0 || (v.baseRevision as number)>=Number.MAX_SAFE_INTEGER-1)
  throw new NotificationInputError();
 return {settings:parseNotificationSettings(v.settings),baseRevision:v.baseRevision as number};
}
export function parseNotificationSnapshot(value: unknown): NotificationSnapshot {
 const v=object(value,["settings","revision"]);
 if(!Number.isSafeInteger(v.revision) || (v.revision as number)<0) throw new NotificationInputError();
 return {settings:parseNotificationSettings(v.settings),revision:v.revision as number};
}
