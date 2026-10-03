import type { Language } from "@/lib/research/data";
import type { PriceTarget } from "@/lib/research/price-targets";
import { formatTargetTime } from "@/lib/research/price-target-time";
import styles from "./price-targets-panel.module.css";

/** One action, one publication time. Retained provenance is not a display row. */
export default function PriceTargetCard({ item, lang, now }: { item: PriceTarget; lang: Language; now: number | null }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const isNew = [item.publishedAt, item.observedAt].every(date => {
    const age = (now ?? Number.NaN) - Date.parse(date);
    return age >= 0 && age < 24 * 60 * 60 * 1000;
  });
  return <article className={styles.card}>
    <span className={styles.ticker}>{item.ticker}</span>
    <div className={styles.body}>
      <div className={styles.firm}>{item.firm}{isNew && <span className={styles.newBadge} aria-label={t("24時間以内の新着", "New within 24 hours")}>NEW</span>}</div>
      <div className={styles.targetChange}>
        <strong>${number(item.previous)} → ${number(item.latest)}</strong>
        <span className={item.latest > item.previous ? styles.raised : styles.lowered}>{item.latest > item.previous ? t("引き上げ", "Raised") : t("引き下げ", "Lowered")}</span>
      </div>
      <time className={styles.published} dateTime={item.publishedAt}>{formatTargetTime(item.publishedAt, lang)}</time>
    </div>
  </article>;
}
