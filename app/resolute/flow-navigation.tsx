"use client";
import { ReviewLink as Link } from "./review-context";
import styles from "./diagnosis.module.css";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
const steps=[
 ["/resolute","① 診断","① Quiz"], ["/resolute/simulation","② シミュレーション","② Simulator"],
 ["/resolute/alerts","③ 終値アラート","③ Closing-price alerts"], ["/resolute/morning","④ 翌朝のひとこと","④ Morning note"],
 ["/resolute/thermometer","⑤ 相場の温度計","⑤ Market gauge"], ["/resolute/tax","⑥ 税金の目安","⑥ Tax estimate"]
];
export default function FlowNavigation({step,locale}:{step:number;locale:DiagnosisLocale}) {
 const en=locale==="en",previous=steps[step-2],next=steps[step];
 return <nav className={styles.flowNavigation} aria-label={en?"Continue through RESOLUTE":"次のツールへ"}>
 {next ? <Link href={next[0]} className={styles.primary} prefetch={false}>{next[en?2:1]}{en?" →":"へ進む →"}</Link> : <Link href="/resolute/notebook" className={styles.primary} prefetch={false}>{en?"Finish my rulebook":"マイルールを仕上げる"}</Link>}
 {previous ? <Link href={previous[0]} className={styles.ghost} prefetch={false}>{en?"← "+previous[2]:"← "+previous[1]+"へ戻る"}</Link>:null}
 </nav>;
}
