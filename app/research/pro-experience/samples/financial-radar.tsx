"use client";
import { useState } from "react";
import { radarGenre, type RadarPayload } from "@/lib/research/radar";
import sample from "@/lib/research/pro-experience-samples/radar.json";
import RadarChart, { PickedDot } from "../../radar/chart";
import { StrengthRanking } from "../../radar/screen";
import radarStyles from "../../radar/radar.module.css";
import styles from "./samples.module.css";

const radar = sample.radar as Extract<RadarPayload, { tier: "pro" }>;
const genre = radarGenre(radar.genre)!;

/** The PRO part of the Financial Radar is the 体力ランキング (owner, Nov 16: 「1つのジャンルで5〜6社を体力ランキングに入れて」); the chart is FREE.
 * One genre (semiconductors, six companies of saved made-up figures): the real ranking first, then the real chart, where a dot can be tapped. */
export default function FinancialRadarSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [selected, setSelected] = useState<string | null>(null);
  return <div className={styles.radar}>
    <p className={styles.genreLine}><span>{ja ? "ジャンル" : "Category"}</span><b>{ja ? genre.ja : genre.en}</b><span>{ja ? `${radar.dots.length}社` : `${radar.dots.length} companies`}</span></p>
    <div className={styles.rankingWrap}><StrengthRanking pro={radar} lang={lang} /></div>
    <p className={styles.chartNote}>{ja ? "下のグラフはFREEでも見られます。点をタップすると数字が出ます。" : "The chart below is also free. Tap a dot to see its figures."}</p>
    <section className={radarStyles.card}>
      <p className={radarStyles.axisY}>{ja ? "↑ 守る力 ｜ 現金÷(借入+リース)" : "↑ Financial resilience | Cash ÷ (debt + leases)"}</p>
      <RadarChart dots={radar.dots} selected={selected} onSelect={setSelected} lang={lang} />
      <p className={radarStyles.axisX}>{ja ? "稼ぐ力 ｜ 売上に対する営業キャッシュフロー →" : "Cash generation | Operating cash flow as % of revenue →"}</p>
      <PickedDot dots={radar.dots} selected={selected} lang={lang} />
    </section>
  </div>;
}
