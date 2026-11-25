"use client";
import type { ReactNode } from "react";
import { ReviewLink as Link } from "./review-context";
import styles from "./diagnosis.module.css";
import pc from "./pc.module.css";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
const steps=[
 ["/resolute/diagnosis","① 診断","① Quiz"], ["/resolute/simulation","② シミュレーション","② Simulator"],
 ["/resolute/alerts","③ 終値アラート","③ Closing-price alerts"], ["/resolute/morning","④ 翌朝のひとこと","④ Morning note"],
 ["/resolute/thermometer","⑤ 相場の温度計","⑤ Market gauge"], ["/resolute/tax","⑥ 税金の目安","⑥ Tax estimate"]
];
/** `wide` (PC, owner Nov 25): one row, the way back on the left and the next step on the right, with `extra` just before it. */
export default function FlowNavigation({step,locale,wide=false,extra}:{step:number;locale:DiagnosisLocale;wide?:boolean;extra?:ReactNode}) {
 const en=locale==="en",previous=steps[step-2],next=steps[step];
 const forward=next ? <Link href={next[0]} className={styles.primary} prefetch={false}>{next[en?2:1]}{en?" →":"へ進む →"}</Link> : <Link href="/resolute/notebook" className={styles.primary} prefetch={false}>{en?"Finish my rulebook":"マイルールを仕上げる"}</Link>;
 const back=previous ? <Link href={previous[0]} className={styles.ghost} prefetch={false}>{en?"← "+previous[2]:"← "+previous[1]+"へ戻る"}</Link>:null;
 if(wide) return <nav className={pc.flow} aria-label={en?"Continue through RESOLUTE":"次のツールへ"}>{back??<span />}<div className={pc.flowEnd}>{extra}{forward}</div></nav>;
 return <nav className={styles.flowNavigation} aria-label={en?"Continue through RESOLUTE":"次のツールへ"}>
 {forward}
 {back}
 </nav>;
}
