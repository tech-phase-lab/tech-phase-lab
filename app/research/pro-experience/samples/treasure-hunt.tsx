"use client";
import { useState } from "react";
import { treasureHuntSample as data } from "@/lib/research/pro-experience-sample-treasure";
import { StaysInSample } from "../../stock-row-link";
import { TreasureHuntCard, UniverseSwitch, ValueRanking } from "../../treasure-hunt/screen";
import styles from "./samples.module.css";

/** One fixed day of トレジャーハント, drawn by the PRO page's own parts: the ハイテク / 全セクター switch, the IN / OUT band, the podium, the list
 * and すべて見る work; a stock stays in the sample (the frame's small 「PROで使えます」). */
export default function TreasureHuntSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [universe, setUniverse] = useState<"tech" | "all">("tech");
  return <StaysInSample.Provider value>
    <div className={styles.tool}>
      <TreasureHuntCard ja={ja} basis={data.basis}>
        <UniverseSwitch universe={universe} onChange={setUniverse} ja={ja} />
        <ValueRanking key={universe} data={data} universe={universe} ja={ja} />
      </TreasureHuntCard>
      <p className={styles.fineNote}>{ja ? "サンプルの数値です。実際のデータではありません。" : "Sample figures, not real data."}</p>
    </div>
  </StaysInSample.Provider>;
}
