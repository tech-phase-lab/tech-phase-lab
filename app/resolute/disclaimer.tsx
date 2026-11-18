import type { CSSProperties } from "react";
import { DISCLAIMER } from "@/lib/legal/disclaimer";

/** The lawyer-reviewed disclaimer sentence, small and faint (owner pack, Nov 17, section 6: 「小さく薄い文字でよい」). Shared by Tech Phase
 * and RESOLUTE: page footers, the end of each Notes / Weekly PRO / Ask Rizel article, the RESOLUTE alert page and under the Shock Gauge.
 * It closes the page content and never appears on a loading screen (owner, Nov 18: it read as large grey text under the loader and
 * was far too obtrusive). 10px, faint, no large margin; iOS must not enlarge it. No CSS module, so any page can drop it in. */
export const DISCLAIMER_STYLE: CSSProperties = { margin: "12px 0 0", fontSize: 10, lineHeight: 1.6, color: "currentColor", opacity: 0.4, overflowWrap: "anywhere", fontWeight: 400, letterSpacing: 0, WebkitTextSizeAdjust: "100%", textSizeAdjust: "100%" };

export default function Disclaimer({ en = false, className }: { en?: boolean; className?: string }) {
  return <p className={className} style={className ? undefined : DISCLAIMER_STYLE} data-disclaimer="">{en ? DISCLAIMER.en : DISCLAIMER.ja}</p>;
}
