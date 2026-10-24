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
