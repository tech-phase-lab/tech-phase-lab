/**
 * RESOLUTE's first-purchase price on the landing pages. It switches by itself at 2027-03-01 00:00 JST
 * (owner, Nov 2026): ¥7,980 → ¥9,800 and $59 → $69. The amount PayPal charges is decided by the payment
 * service when the order is created (services/resolute-api/payments/policy.mjs, same LAUNCH_END); this only
 * decides what the page shows, from the server's clock.
 */
export const RESOLUTE_LAUNCH_END = Date.parse("2027-03-01T00:00:00+09:00");
export type ResolutePrice = { launch: boolean; value: string };
export function resolutePrice(language: "ja" | "en", now = Date.now()): ResolutePrice {
 const launch = now < RESOLUTE_LAUNCH_END;
 return language === "ja" ? { launch, value: launch ? "7980" : "9800" } : { launch, value: launch ? "59.00" : "69.00" };
}
