import type { CompanyWireItem } from "./company-wire.ts";

/** The company headlines the page has already fetched (by the top strip), shared with the home news list so
 * both read one copy and the page asks for them once. */
type Wire = Record<string, CompanyWireItem[]>;
const EMPTY: Wire = {};
let current: Wire = EMPTY;
const listeners = new Set<() => void>();
export function publishWire(items: Wire) { current = items; listeners.forEach(listener => listener()); }
export const wireSnapshot = () => current;
export const serverWireSnapshot = () => EMPTY;
export function subscribeWire(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
