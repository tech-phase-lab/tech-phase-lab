import { parsePriceAlerts, type PriceAlert } from './favorite-lists.ts';

export function upsertPriceAlert(alerts: PriceAlert[], draft: PriceAlert):
  { ok: true; alerts: PriceAlert[] } | { ok: false; error: 'invalid' | 'limit' } {
  if (parsePriceAlerts([draft]).length !== 1) return { ok: false, error: 'invalid' };
  const index = alerts.findIndex(item => item.ticker === draft.ticker && item.direction === draft.direction);
  if (index < 0 && alerts.length >= 100) return { ok: false, error: 'limit' };
  return { ok: true, alerts: index < 0 ? [...alerts, draft] : alerts.map((item, i) => i === index ? draft : item) };
}

// Alert thresholds must retain their saved precision, unlike rounded quote prices.
export function formatAlertPrice(price: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(price);
}

/** What the price-alert sheet says about delivery (Nov 21), from GET /api/research/notifications. "live" only when the monitor delivers
 * price alerts (its PRICE_ALERT_PUSH_ENABLED switch) and this member may receive Tech Phase notices (PRO, or an owner account, which the
 * server reports as PRO). Anything unclear keeps the old wording: settings are saved, delivery is not ready. */
export type PriceAlertDelivery = "live" | "pro-required" | "not-ready";
export function priceAlertDelivery(body: unknown): PriceAlertDelivery {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (value.reason === "pro-required" || (value.enabled === true && value.pro === false)) return "pro-required";
  return value.enabled === true && value.pro !== false && value.priceAlerts === true ? "live" : "not-ready";
}
