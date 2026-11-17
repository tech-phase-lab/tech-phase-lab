/** The one disclaimer sentence from the lawyer's review (owner pack, Nov 17, section 6). Shown small and faint in every page
 * footer (Tech Phase and RESOLUTE), at the end of each Notes / Weekly PRO / Ask Rizel article, on the RESOLUTE alert page a
 * phone notification opens, and under the Shock Gauge. The English follows Article 2, Paragraph 2 of the English terms.
 * One source for every place: import it, never retype it. */
export const DISCLAIMER = {
  ja: "本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。",
  en: "The Service and the Product are intended to provide information and to help you manage rules you set for yourself. They do not recommend buying or selling any particular security or the timing of trades. Please make your own investment decisions.",
} as const;

export function disclaimerText(lang: "ja" | "en"): string { return DISCLAIMER[lang]; }
