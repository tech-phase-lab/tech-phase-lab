"use client";
import { useState } from "react";
import { TREASURE_NOTE, treasureHuntSample as data } from "@/lib/research/pro-experience-sample-treasure";
import { StaysInSample } from "../../stock-row-link";
import { TreasureHuntCard, UniverseSwitch, ValueCredit, ValueRanking } from "../../treasure-hunt/screen";
import CardHead from "./card-head";
import styles from "./samples.module.css";

/** One fixed day of トレジャーハント (owner's mockup 01, Nov 22), drawn by the PRO page's own parts: the ハイテク / 全セクター switch, the
 * IN / OUT band, the podium and 4th to 7th; a gold note in place of すべて見る. A stock stays in the sample (the frame's 「PROで使えます」). */
export default function TreasureHuntSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [universe, setUniverse] = useState<"tech" | "all">("tech");
  return <StaysInSample.Provider value>
    <div className={styles.tool}>
      <TreasureHuntCard ja={ja} basis={data.basis} top={<CardHead lang={lang} />}>
        <UniverseSwitch universe={universe} onChange={setUniverse} ja={ja} />
        <ValueRanking key={universe} data={data} universe={universe} ja={ja} note={TREASURE_NOTE[universe][lang]} withYear />
        <ValueCredit ja={ja} />
      </TreasureHuntCard>
    </div>
  </StaysInSample.Provider>;
}
