/** The share price move after a results release, from the provider's own quote fields only (nothing inferred). Cause is never stated here. */
export type ReactionQuote = {
  price: number; percentChange: number | null; asOf: string; session: "regular" | "pre" | "post" | "closed";
  extended?: { price: number; percentChange: number; asOf: string; session: "pre" | "post" };
};
export type ReactionLine = { label: string; labelEn: string; percent: number; at: string; base: string; baseEn: string };

/** Only moves stamped at or after the release count: an earlier stamp is the pre-release price. Returns [] when nothing qualifies. */
export function reactionLines(quote: ReactionQuote | null | undefined, releasedAt: string): ReactionLine[] {
  const since = Date.parse(releasedAt);
  if (!quote || !Number.isFinite(since)) return [];
  const out: ReactionLine[] = [];
  if (quote.percentChange !== null && Number.isFinite(quote.percentChange) && Date.parse(quote.asOf) >= since) out.push({ label: "通常取引", labelEn: "Regular session", percent: quote.percentChange, at: quote.asOf, base: "前日終値比", baseEn: "vs. previous close" });
  const x = quote.extended;
  if (x && Number.isFinite(x.percentChange) && Date.parse(x.asOf) >= since) out.push({ label: x.session === "pre" ? "プレマーケット" : "時間外", labelEn: x.session === "pre" ? "Pre-market" : "After hours", percent: x.percentChange, at: x.asOf, base: "通常取引の終値比", baseEn: "vs. regular-session close" });
  return out;
}
export const percentText = (p: number) => `${p >= 0 ? "+" : "-"}${Math.abs(p).toFixed(2)}%`;
