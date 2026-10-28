"use client";
import { useId, useState, type ReactNode } from "react";
import ScoreMethod from "./score-method";
import styles from "./styles.module.css";
export default function DetailPanels({lang,children,method}:{lang:"ja"|"en";children:ReactNode;method?:ReactNode}) {
  const [open,setOpen]=useState<"evidence"|"method"|null>(null),id=useId(),ja=lang==="ja";
  return <section className={styles.detailPanels}>
    <div className={styles.detailButtons}>
      {(["evidence","method"] as const).map(key=><button key={key} id={`${id}-${key}-button`} type="button" aria-expanded={open===key} aria-controls={`${id}-${key}`} onClick={()=>setOpen(open===key?null:key)}><span aria-hidden="true">{open===key?"−":"＋"}</span>{key==="evidence"?(ja?"長所・短所の詳細":"Strengths & weaknesses"):(ja?"スコアの見方":"Score guide")}</button>)}
    </div>
    <div id={`${id}-evidence`} role="region" aria-labelledby={`${id}-evidence-button`} hidden={open!=="evidence"} className={styles.analysisDetails}>{children}</div>
    <div id={`${id}-method`} role="region" aria-labelledby={`${id}-method-button`} hidden={open!=="method"}>{method ?? <ScoreMethod lang={lang} embedded/>}</div>
  </section>;
}
