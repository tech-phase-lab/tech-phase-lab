"use client";
import { useState } from "react";
import { whaleTracksSample as data } from "@/lib/research/pro-experience-sample-whales";
import { StaysInSample } from "../../stock-row-link";
import { FIRST_SORTS, WhalePanel, WhaleTabBar, WhaleTracksSheet } from "../../whales/screen";
import styles from "./samples.module.css";

type Tab = keyof typeof FIRST_SORTS;

/** クジラの足あと at one fixed moment, drawn by the PRO page's own parts: all four tabs and their sort buttons work; a stock stays in the
 * sample (the frame's small 「PROで使えます」). */
export default function WhaleTracksSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [tab, setTab] = useState<Tab>("institutions");
  const [sorts, setSorts] = useState<Record<Tab, string>>(FIRST_SORTS);
  return <StaysInSample.Provider value>
    <div className={styles.tool}>
      <WhaleTracksSheet ja={ja}>
        <WhaleTabBar tab={tab} onChange={setTab} ja={ja} />
        <WhalePanel data={data} tab={tab} sort={sorts[tab]} onSort={sort => setSorts(current => ({ ...current, [tab]: sort }))} ja={ja} />
      </WhaleTracksSheet>
      <p className={styles.fineNote}>{ja ? "サンプルの数値です。実際のデータではありません。" : "Sample figures, not real data."}</p>
    </div>
  </StaysInSample.Provider>;
}
