import type { PriceTarget } from "./price-targets.ts";
/** The price target list the panel last verified, shared with the home TODAY
 * row so its count is read from the same data the cards show. null while
 * loading or after a failed check. */
let items: PriceTarget[] | null = null;
const listeners = new Set<() => void>();
export const priceTargetSnapshot = () => items;
export const serverPriceTargetSnapshot = () => null;
export function subscribePriceTargets(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishPriceTargets(value: PriceTarget[] | null) {
  items = value;
  listeners.forEach(listener => listener());
}
