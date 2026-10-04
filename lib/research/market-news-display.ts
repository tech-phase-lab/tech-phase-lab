import type { Language } from "./data";
import type { MarketUpdate } from "./general-news";

/** Compact only the known index template; do not infer roles from arbitrary prose. */
export function marketNewsDisplay(item: MarketUpdate, lang: Language) {
  const ja = lang === "ja";
  const labels = ja
    ? { "index-membership": "指数の組み入れ・除外", "government-bonds": "国債", "crude-oil": "原油" }
    : { "index-membership": "Index membership", "government-bonds": "Government bonds", "crude-oil": "Crude oil" };
  const title = ja ? item.titleJa : item.titleEn;
  if (ja && item.topic === "index-membership") {
    const match = /^(Nasdaq-100|S&P 500)指数：追加予定 [^（）$]+（(\$[A-Z]{1,6})）、除外予定 [^（）$]+（(\$[A-Z]{1,6})）。?$/.exec(title);
    if (match) return { label: labels[item.topic], title: `${match[1]}：追加予定 ${match[2]}　除外予定 ${match[3]}` };
  }
  return { label: labels[item.topic], title };
}

/** The market feed contains only headline fields, not a separate verified body.
 * Expanding company names in a compact headline does not add reporting. */
export const marketNewsBody: (item: MarketUpdate, lang: Language) => undefined = () => undefined;
