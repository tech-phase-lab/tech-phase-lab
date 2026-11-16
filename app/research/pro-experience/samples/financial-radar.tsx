"use client";
import { useState } from "react";
import type { RadarDotPro } from "@/lib/research/radar";
import sample from "@/lib/research/pro-experience-samples/radar.json";
import RadarChart from "../../radar/chart";
import { RankCard } from "../../radar/screen";
import radarStyles from "../../radar/radar.module.css";
import styles from "./samples.module.css";

const dots = sample.radar.dots as RadarDotPro[];

/** The same four stocks as the comparison sample, on the PRO radar: switch between them with the buttons or by tapping a dot. */
export default function FinancialRadarSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [selected, setSelected] = useState<string>(dots[0].ticker);
  const dot = dots.find(item => item.ticker === selected) ?? dots[0];
  return <div className={styles.radar}>
    <div className={styles.pills} role="group" aria-label={ja ? "銘柄" : "Stock"}>
      {dots.map(item => <button key={item.ticker} type="button" className={styles.pill} aria-pressed={item.ticker === selected} onClick={() => setSelected(item.ticker)}>{item.ticker}</button>)}
    </div>
    <section className={radarStyles.card}>
      <p className={radarStyles.axisY}>{ja ? "↑ 守る力 ｜ 現金÷(借入+リース)" : "↑ Financial resilience | Cash ÷ (debt + leases)"}</p>
      <RadarChart dots={dots} selected={selected} onSelect={ticker => { if (ticker) setSelected(ticker); }} lang={lang} />
      <p className={radarStyles.axisX}>{ja ? "稼ぐ力 ｜ 売上に対する営業キャッシュフロー →" : "Cash generation | Operating cash flow as % of revenue →"}</p>
    </section>
    <section className={radarStyles.ranking}><RankCard dot={dot} lang={lang} /></section>
  </div>;
}
