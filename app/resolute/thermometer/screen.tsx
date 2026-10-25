"use client";
import { useState } from "react";
import ToolShell from "../tool-shell";
import {useReview} from "../review-context";
import FlowNavigation from "../flow-navigation";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import styles from "../diagnosis.module.css";
import { gaugeReading, gaugeStatus, temperatureLabels, type ThermometerSnapshot } from "@/lib/resolute/thermometer-view";
import type { ThermometerIndex } from "@/lib/resolute/thermometer";
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
export default function ThermometerScreen({ identityReady = true, snapshot }: { identityReady?: boolean; snapshot?: ThermometerSnapshot }) {
  return <ToolShell identityReady={identityReady}>{locale => <MarketGauge locale={locale} snapshot={snapshot}/>}</ToolShell>;
}
export function MarketGauge({ locale, snapshot }: { locale: DiagnosisLocale; snapshot?: ThermometerSnapshot }) {
  const review=useReview(), sample=!!review&&review.scenario!=='live';
  const [index, setIndex] = useState<ThermometerIndex>("nas100");
  const [selected, setSelected] = useState<number | null>(null);
  const en = locale === "en", t = (ja: string, eng: string) => en ? eng : ja;
  const reading = sample ? null : gaugeReading(snapshot, index);
  const score = sample ? (index === "nas100" ? 86 : 34) : reading?.score;
  const label = sample ? temperatureLabels[locale][index === "nas100" ? 4 : 1] : reading ? temperatureLabels[locale][reading.band] : "—";
  const vix = !sample && snapshot?.vix.status === "ready" && snapshot.vix.asOf === snapshot.asOf && Number.isFinite(snapshot.vix.level) && snapshot.vix.level > 0 && Number.isFinite(snapshot.vix.percentile) && snapshot.vix.percentile >= 0 && snapshot.vix.percentile <= 100 ? snapshot.vix : null;
  const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  return <div className={styles.section}>
    <header className={styles.toolHeading}><h1>{t("相場の温度計", "Market gauge")}</h1><p className={styles.muted}>{t("いまの相場の位置を、ひと目でつかむ", "See where the market stands at a glance")}</p></header>
    <section className={`${styles.card} ${styles.hero} ${styles.gaugeHero}`}>
      <span className={styles.eyebrow}>MARKET THERMOMETER</span>
      <div className={styles.tabs} role="group" aria-label={t("対象指数", "Market index")}>
        <button type="button" aria-pressed={index === "nas100"} onClick={() => setIndex("nas100")}>NAS100</button>
        <button type="button" aria-pressed={index === "sox"} onClick={() => setIndex("sox")}>SOX</button>
      </div>
      <p className={styles.muted}>{index === "nas100" ? "NASDAQ-100" : t("フィラデルフィア半導体指数", "PHLX Semiconductor Index")}</p>
      <svg className={styles.gauge} viewBox="0 0 300 170" role="img" aria-label={`${index === "nas100" ? "NAS100" : "SOX"} · ${label}${sample ? t("・表示見本", " · Display sample") : ""}`}>
        {colors.map((color, i) => <path key={color} d={segment(i)} fill={color} opacity={score !== undefined ? 1 : .28}/>)}
        {Array.from({length:21},(_,k)=>{const a=(180-k*9)*Math.PI/180,r=k%5===0?80:84;return <line key={k} x1={150+88*Math.cos(a)} y1={150-88*Math.sin(a)} x2={150+r*Math.cos(a)} y2={150-r*Math.sin(a)} stroke="#9aa8b8" strokeOpacity={k%5===0?.7:.35} strokeWidth={k%5===0?1.5:1}/>;})}
        <path d="M146.5 150 L150 52 L153.5 150 Z" fill="#f3dfae" opacity={score !== undefined ? 1 : 0} transform={score !== undefined ? `rotate(${score * 1.8 - 90} 150 150)` : undefined}/>
        <circle cx="150" cy="150" r="9" fill="#0a1018" stroke="#d8b36a" strokeWidth="2"/>
        <text x="15" y="165" fill="currentColor" fontSize="12">{t("冷えている", "Cool")}</text><text x="285" y="165" textAnchor="end" fill="currentColor" fontSize="12">{t("熱い", "Hot")}</text>
      </svg>
      <div aria-live="polite" aria-atomic="true">
        <p className={styles.gaugeEmpty}>{label}</p>
        <p className={styles.status}>{sample ? t("表示見本・実際の相場ではありません", "Display sample · Not actual market data") : reading ? `${reading.asOf} ${t("米国市場の終値", "US market close")}` : gaugeStatus(snapshot, index, en)}</p>
      </div>
      {reading ? <dl className={styles.resultRows}>
        <div><dt>{t("252営業日高値から", "From the 252-session closing high")}</dt><dd>{signedPercent(reading.drawdownPercent)}</dd></div>
        <div><dt>{t("200日移動平均から", "From the 200-day moving average")}</dt><dd>{signedPercent(reading.deviationPercent)}</dd></div>
      </dl> : null}
    </section>
    <section className={styles.card}>
      <div className={styles.switchRow}><h2>{t("市場の警戒度", "Market caution")}</h2><span className={styles.eyebrow}>VIX</span></div>
      <p className={styles.bigNumber}>{vix ? vix.level.toFixed(2) : "—"}</p>
      <p className={styles.muted}>{vix ? `${vix.asOf} · ${t("過去10年内の位置", "Position over the past 10 years")} ${vix.percentile.toFixed(0)} / 100` : t("確定したデータの取得後に表示します。", "Shown once confirmed data is available.")}</p>
      <p className={styles.disclaimer}>{t("S&P500の予想変動率です。温度の判定には含めません。", "Expected S&P 500 volatility. Not included in the temperature score.")}</p>
    </section>
    <section className={styles.card}><h2>{t("4つの位置", "Four ways the market can look")}</h2><p className={styles.muted}>{t("マスを押すと、説明が出ます。", "Tap a box to see what it means.")}</p>
      <div className={styles.mapAxis}><span>{t("◀ 冷えている", "◀ Cool")}</span><span>{t("行き過ぎ", "Temperature")}</span><span>{t("熱い ▶", "Hot ▶")}</span></div>
      <div className={styles.marketMap} role="group" aria-label={t("トレンドと相場の温度", "Trend and market temperature")}>{positions.map((p, i) => <button key={p.en} aria-label={p[locale]} aria-pressed={selected === i} aria-controls="market-position-description" onClick={() => setSelected(i)}>{p[locale].split(" × ").map((line,k)=><span key={k}>{line}</span>)}</button>)}</div>
      <div id="market-position-description" aria-live="polite">{selected !== null ? <><h2>{positions[selected][locale]}</h2><p>{en ? positions[selected].detailEn : positions[selected].detailJa}</p></> : <p className={styles.muted}>{t("それぞれの位置の意味を確認できます。", "See what each combination means.")}</p>}</div>
    </section>
    <section className={styles.card}><div className={styles.switchRow}><h2>{t("セクター別", "By sector")}</h2><span className={styles.badge}>{t("通知利用権", "Alerts access")}</span></div>
      {[["半導体", "Semiconductors"], ["クラウド・AI", "Cloud & AI"], ["ソフトウェア", "Software"], ["通信機器", "Networking"], ["ヘルスケア", "Healthcare"]].map(([ja, eng]) => <div className={styles.sectorRow} key={eng}><span>{t(ja, eng)}</span><span className={styles.muted}>{t("準備中", "Coming soon")}</span></div>)}
    </section>
    <details className={`${styles.card} ${styles.disclosure}`}><summary>{t("この温度計の判断のしかた", "How this gauge works")}</summary><dl className={styles.methodRows}>
      <div><dt>{t("更新のタイミング", "When it updates")}</dt><dd>{t("米国市場の終値が確定したあと、1日1回の更新を予定しています。", "We plan to update this once a day, after US closing prices are confirmed.")}</dd></div>
      <div><dt>{t("行き過ぎの見方", "How we measure market temperature")}</dt><dd>{t("252営業日の終値高値からの下落率と、200日移動平均からの乖離率を使います。それぞれを過去10年と比較し、同じ重みで合成した値を再び順位づけして5段階に分けます。NAS100とSOXは別々に計算します。", "We compare the drawdown from the 252-session closing high and the deviation from the 200-day moving average with the preceding 10 years. We weight their percentiles equally, rank the combined measure again, and divide it into five bands. NAS100 and SOX are calculated separately.")}</dd></div>
      <div><dt>{t("5段階の読み方", "Reading the five bands")}</dt><dd>{t("冷えている・やや冷え・平常・やや熱い・熱い。過去の分布を20%ずつに区切ります。同じ値が多い場合、各段階の件数は均等になりません。", "Cool, slightly cool, normal, slightly hot, and hot. Boundaries are set at 20-percentile intervals. Tied values can make the bands uneven in size.")}</dd></div>
      <div><dt>{t("データの出どころ", "Data source")}</dt><dd>Twelve Data</dd></div>
    </dl></details>
    <p className={styles.disclaimer}>{t("これからの値動きを当てるものではありません。あくまでも一つの指標として捉えてください。", "This does not predict future moves. Treat it as one indicator among many.")}</p>
    <FlowNavigation step={5} locale={locale}/>
  </div>;
}
