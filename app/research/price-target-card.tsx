import type { Language } from "@/lib/research/data";
import type { PriceTarget } from "@/lib/research/price-targets";
import { formatTargetTime } from "@/lib/research/price-target-time";
import styles from "./price-targets-panel.module.css";

/** One action, one publication time. Retained provenance is not a display row. */
export default function PriceTargetCard({ item, lang, now }: { item: PriceTarget; lang: Language; now: number | null }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Owner, Oct 16: a full day of NEW made yesterday's and today's targets look alike; it now marks only the last three hours.
  const isNew = [item.publishedAt, item.observedAt].every(date => {
    const age = (now ?? Number.NaN) - Date.parse(date);
    return age >= 0 && age < 3 * 60 * 60 * 1000;
  });
  const up = item.latest > item.previous;
  const percent = item.previous > 0 ? (item.latest / item.previous - 1) * 100 : null;
  return <article className={`${styles.card} ${up ? styles.up : styles.down}`}>
    <span className={styles.ticker}>{item.ticker}</span>
    <div className={styles.body}>
      <div className={styles.firm}>{item.firm}{isNew && <span className={styles.newBadge} aria-label={t("3時間以内の新着", "New within 3 hours")}>NEW</span>}</div>
      <div className={styles.targetChange}><strong>${number(item.previous)} → ${number(item.latest)}</strong></div>
      <time className={styles.published} dateTime={item.publishedAt}>{formatTargetTime(item.publishedAt, lang)}</time>
    </div>
    <div className={styles.chip}>
      <span className={up ? styles.raised : styles.lowered}>{up ? t("引き上げ", "Raised") : t("引き下げ", "Lowered")}</span>
      {percent !== null && <em>{up ? "+" : ""}{percent.toFixed(1)}%</em>}
    </div>
  </article>;
}
