import { useState } from "react";
import type { Language } from "@/lib/research/data";
import type { PriceTarget } from "@/lib/research/price-targets";
import { formatTargetTime } from "@/lib/research/price-target-time";
import { priceTargetSplitView } from "@/lib/research/price-target-splits";
import styles from "./price-targets-panel.module.css";
import fit from "./price-target-card.module.css";

/** One action, one publication time. Retained provenance is not a display row. */
export default function PriceTargetCard({ item, lang, now }: { item: PriceTarget; lang: Language; now: number | null }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const [showFirm, setShowFirm] = useState(false);
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Owner, Oct 16: a full day of NEW made yesterday's and today's targets look alike; it now marks only the last three hours.
  const isNew = [item.publishedAt, item.observedAt].every(date => {
    const age = (now ?? Number.NaN) - Date.parse(date);
    return age >= 0 && age < 3 * 60 * 60 * 1000;
  });
  // Stock splits (SNDK 8-for-1, Nov 20 2026): a pre-split old target is a basis change, not a cut; an action from before a split is also
  // shown on today's basis. The clock is the page's (or the observation time before it is known), so server and browser agree.
  const split = priceTargetSplitView(item, now ?? Date.parse(item.observedAt));
  const previous = split?.kind === "previous-pre-split" ? split.previous : item.previous;
  const up = item.latest > previous;
  const percent = previous > 0 ? (item.latest / previous - 1) * 100 : null;
  const ratio = split ? `${Number(split.ratio.toFixed(4))}:1` : "";
  return <article className={`${styles.card} ${up ? styles.up : styles.down}`}>
    <span className={styles.ticker}>{item.ticker}</span>
    <div className={styles.body}>
      {/* Owner, Nov 13: a long broker name pushed NEW onto its own line. The name now stays on one line (cut with …) and NEW sits right after it; tap the name to read all of it. */}
      <div className={`${styles.firm} ${fit.firmRow}`}><button type="button" className={fit.firmName} title={item.firm} aria-expanded={showFirm} onClick={() => setShowFirm(value => !value)}>{item.firm}</button>{isNew && <span className={`${styles.newBadge} ${fit.badge}`} aria-label={t("3時間以内の新着", "New within 3 hours")}>NEW</span>}</div>
      <div className={styles.targetChange}><strong>${number(previous)} → ${number(item.latest)}</strong></div>
      {split?.kind === "before-split" && <small className={fit.splitNote}>{t(`株式分割（${ratio}、${split.date.slice(5).replace("-", "/")}）前の基準。分割後の換算 $${number(split.previous)} → $${number(split.latest)}`, `Before the ${ratio} split (${split.date.slice(5).replace("-", "/")}); on today's basis $${number(split.previous)} → $${number(split.latest)}`)}</small>}
      {split?.kind === "previous-pre-split" && <small className={fit.splitNote}>{t(`旧目標 $${number(item.previous)} は株式分割（${ratio}）前の基準。分割後に換算して表示`, `Old target $${number(item.previous)} was before the ${ratio} split; shown on today's basis`)}</small>}
      <time className={styles.published} dateTime={item.publishedAt}>{formatTargetTime(item.publishedAt, lang)}</time>
    </div>
    <div className={styles.chip}>
      <span className={up ? styles.raised : styles.lowered}>{up ? t("引き上げ", "Raised") : t("引き下げ", "Lowered")}</span>
      {percent !== null && <em>{up ? "+" : ""}{percent.toFixed(1)}%</em>}
    </div>
  </article>;
}
