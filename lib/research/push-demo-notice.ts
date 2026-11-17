/** Nov 17 (owner): the sample price-target notice the owner sends to their own phone to film the PRO video.
 * The monitor builds and sends it (scripts/research/web_push.py demo_price_target, through price_target_payload, the same function
 * as every real price-target notice). This file only shows the owner the exact text before sending; a test checks that it matches
 * what the monitor sends. Fictional firm and numbers, never a real firm name. */
export const DEMO_PRICE_TARGET = { ticker: "NVDA", firm: "Sample Securities", previous: 295, latest: 340 } as const;
export type DemoLanguage = "ja" | "en";
export const DEMO_LANGUAGES: readonly DemoLanguage[] = ["ja", "en"];

/** The title and body as the phone shows them, in the same format as a real price-target notice. */
export function demoPriceTargetText(language: DemoLanguage): { title: string; body: string } {
  const { ticker, firm, previous, latest } = DEMO_PRICE_TARGET;
  return { title: `${ticker} · ${language === "ja" ? "目標株価の変更" : "Price target update"}`, body: `${firm}: $${previous} → $${latest}` };
}
