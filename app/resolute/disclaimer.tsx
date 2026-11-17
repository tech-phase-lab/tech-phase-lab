import type { CSSProperties } from "react";
import { DISCLAIMER } from "@/lib/legal/disclaimer";

/** The lawyer-reviewed disclaimer sentence, small and faint (owner pack, Nov 17, section 6). Shared by Tech Phase and RESOLUTE:
 * page footers, the end of each Notes / Weekly PRO / Ask Rizel article, the RESOLUTE alert page and under the Shock Gauge.
 * No CSS module, so any page can drop it in without importing its styles. */
const style: CSSProperties = { margin: "16px 0 0", fontSize: 11, lineHeight: 1.7, color: "currentColor", opacity: 0.55, overflowWrap: "anywhere", fontWeight: 400, letterSpacing: 0 };

export default function Disclaimer({ en = false, className }: { en?: boolean; className?: string }) {
  return <p className={className} style={className ? undefined : style} data-disclaimer="">{en ? DISCLAIMER.en : DISCLAIMER.ja}</p>;
}
