"use client";
import { periodPercent, type ChangePeriod, type PeriodBase } from "@/lib/research/period-change";
import styles from "./period-change-line.module.css";

const NAMES: Record<ChangePeriod, [string, string]> = { "1w": ["1週間", "1W"], "1m": ["1ヶ月", "1M"], "6m": ["6ヶ月", "6M"], "1y": ["1年", "1Y"], ytd: ["年初来", "YTD"], "5y": ["5年", "5Y"] };

/** "6ヶ月の騰落率 −6.15%" under the period buttons, 20px below them (owner, Nov 15: no arrow and no "5/13 845.99 から" base; the colour and the sign stay), and a glowing line in the same colour. The glow is a second, 8px line
 * of the same gradient blurred by 5px (a box-shadow leaves the glow at both ends and splits them in two). Nothing is shown without a base. */
export default function PeriodChangeLine({ period, base, price, ja }: { period: ChangePeriod; base: PeriodBase | undefined; price: number | null; today: string; ja: boolean }) {
  const percent = base && price !== null ? periodPercent(price, base) : null;
  if (!base || percent === null) return null;
  const up = percent >= 0, sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return <div className={styles.wrap} data-tone={up ? "up" : "down"}>
    <p className={styles.line}>
      <span className={styles.label}>{ja ? `${NAMES[period][0]}の騰落率` : `${NAMES[period][1]} change`}</span>
      <span className={styles.value}>{sign}{Math.abs(percent).toFixed(2)}%</span>
    </p>
    <div className={styles.glow} aria-hidden="true"><i /><i /></div>
  </div>;
}
