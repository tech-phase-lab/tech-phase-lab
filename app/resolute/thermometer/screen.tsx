"use client";
import { useState } from "react";
import ToolShell from "../tool-shell";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import styles from "../diagnosis.module.css";
const positions = [
  { ja: "上向き × 冷えている", en: "Rising × Cool", detailJa: "上昇が続いていますが、相場の価格は最近の水準より低い状態です。", detailEn: "The market is trending upward, but prices are below recent levels." },
  { ja: "上向き × 熱い", en: "Rising × Hot", detailJa: "上昇が続いていて、相場の価格が最近の水準より高い状態です。", detailEn: "The market is trending upward, with prices above recent levels." },
  { ja: "下向き × 冷えている", en: "Falling × Cool", detailJa: "下落が続いていて、相場の価格が最近の水準より低い状態です。", detailEn: "The market is trending downward, with prices below recent levels." },
  { ja: "下向き × 熱い", en: "Falling × Hot", detailJa: "下落が続いていますが、相場の価格は最近の水準より高い状態です。", detailEn: "The market is trending downward, but prices remain above recent levels." },
];
const colors = ["#6f93bd", "#8db8ee", "#d8b36a", "#e9a65a", "#e5766a"];
function segment(i: number) {
  const point = (r: number, d: number) => `${(150 + r * Math.cos(d * Math.PI / 180)).toFixed(2)} ${(150 - r * Math.sin(d * Math.PI / 180)).toFixed(2)}`;
  const start = 180 - i * 36 - 1.5, end = 180 - (i + 1) * 36 + 1.5;
  return `M${point(124, start)} A124 124 0 0 1 ${point(124, end)} L${point(98, end)} A98 98 0 0 0 ${point(98, start)} Z`;
}
export default function ThermometerScreen({ identityReady = true }: { identityReady?: boolean }) {
  return <ToolShell identityReady={identityReady}>{locale => <MarketGauge locale={locale}/>}</ToolShell>;
}
function MarketGauge({ locale }: { locale: DiagnosisLocale }) {
  const [selected, setSelected] = useState<number | null>(null);
  const en = locale === "en", t = (ja: string, eng: string) => en ? eng : ja;
  return <div className={styles.section}>
    <header className={styles.toolHeading}><span className={styles.eyebrow}>05 / MARKET GAUGE</span><h1>{t("相場の温度計", "Market gauge")}</h1><p className={styles.muted}>{t("いまの相場の位置を、ひと目でつかむ", "See where the market stands at a glance")}</p></header>
    <section className={`${styles.card} ${styles.hero} ${styles.gaugeHero}`}>
      <h2>{t("行き過ぎのメーター", "Market temperature")}</h2>
      <svg className={styles.gauge} viewBox="0 0 300 170" role="img" aria-label={t("相場の温度計。現在値は準備中です。", "Market gauge. Current reading is not available yet.")}>
        {colors.map((color, i) => <path key={color} d={segment(i)} fill={color} opacity=".5"/>)}
        <text x="15" y="165" fill="currentColor" fontSize="12">{t("冷えている", "Cool")}</text><text x="285" y="165" textAnchor="end" fill="currentColor" fontSize="12">{t("熱い", "Hot")}</text>
      </svg>
      <p className={styles.gaugeEmpty}>—</p><p className={styles.status}>{t("準備中です。", "Coming soon.")}</p>
      <p className={styles.muted}>{t("現在の相場の判定はまだ表示していません。", "Current market readings are not available yet.")}</p>
    </section>
    <section className={styles.card}><h2>{t("4つの位置", "Four market positions")}</h2><p className={styles.muted}>{t("マスを押すと、説明が出ます。", "Tap a box to see what it means.")}</p>
      <div className={styles.mapAxis}><span>{t("◀ 冷えている", "◀ Cool")}</span><span>{t("熱い ▶", "Hot ▶")}</span></div>
      <div className={styles.marketMap} role="group" aria-label={t("トレンドと相場の温度", "Trend and market temperature")}>{positions.map((p, i) => <button key={p.en} aria-pressed={selected === i} aria-controls="market-position-description" onClick={() => setSelected(i)}>{p[locale]}</button>)}</div>
      <div id="market-position-description" aria-live="polite">{selected !== null ? <><h2>{positions[selected][locale]}</h2><p>{en ? positions[selected].detailEn : positions[selected].detailJa}</p></> : <p className={styles.muted}>{t("それぞれの位置の意味を確認できます。", "Explore what each position means.")}</p>}</div>
    </section>
    <section className={styles.card}><div className={styles.switchRow}><h2>{t("セクター別", "By sector")}</h2><span className={styles.badge}>{t("通知利用権", "Alerts access")}</span></div>
      {[["半導体", "Semiconductors"], ["クラウド・AI", "Cloud & AI"], ["ソフトウェア", "Software"], ["通信機器", "Networking"], ["ヘルスケア", "Healthcare"]].map(([ja, eng]) => <div className={styles.sectorRow} key={eng}><span>{t(ja, eng)}</span><span className={styles.muted}>{t("準備中", "Coming soon")}</span></div>)}
    </section>
    <details className={styles.card}><summary>{t("この温度計の判断のしかた", "How this gauge works")}</summary><dl className={styles.methodRows}>
      <div><dt>{t("更新のタイミング", "When it updates")}</dt><dd>{t("米国市場の終値が確定したあと、1日1回の更新を予定しています。", "Planned updates: once a day, after the US market close is final.")}</dd></div>
      {[["トレンドの見方", "How we read the trend"], ["行き過ぎの見方", "How we measure market temperature"], ["データの出どころ", "Data source"]].map(([ja, eng]) => <div key={eng}><dt>{t(ja, eng)}</dt><dd>{t("準備中です。", "Coming soon.")}</dd></div>)}
    </dl></details>
    <p className={styles.disclaimer}>{t("これからの値動きを当てるものではありません。あくまでも一つの指標として捉えてください。", "This does not predict future moves. Treat it as one indicator among many.")}</p>
  </div>;
}
