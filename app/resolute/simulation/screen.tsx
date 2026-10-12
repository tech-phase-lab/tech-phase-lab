"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import ToolShell from "../tool-shell";
import styles from "../diagnosis.module.css";
import { requestPlan,PlanClientError } from "@/lib/resolute/plan-client";
import type { PlanInput } from "@/lib/resolute/plan-data";
import { simulateDrop,simulateSurge } from "@/lib/resolute/simulate";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
export default function SimulationScreen({identityReady=true}:{identityReady?:boolean}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><Simulation locale={locale} deny={deny}/>}</ToolShell>;
}
function Simulation({locale,deny}:{locale:DiagnosisLocale;deny:()=>void}) {
 const [plan,setPlan]=useState<PlanInput|null>(null),[state,setState]=useState("loading"),[attempt,setAttempt]=useState(0);
 const [holding,setHolding]=useState(""),[drop,setDrop]=useState("30"),[stock,setStock]=useState(""),[rise,setRise]=useState("30");
 const denyRef=useRef(deny);useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{const controller=new AbortController();
  void requestPlan(undefined,controller.signal).then(p=>{if(controller.signal.aborted)return;
   setPlan(p.plan);setState(p.plan?"ready":"empty");
   if(p.plan){const base=p.plan.investedAmount && p.plan.investedAmount>0?p.plan.investedAmount:p.plan.investable;setHolding(base===null?"":String(base/(p.plan.currency==="USD"?100:1)));}
  },e=>{if(controller.signal.aborted)return;if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind))denyRef.current();else setState("error");});
  return()=>controller.abort();},[attempt]);
 const en=locale==="en",t=(ja:string,eng:string)=>en?eng:ja;
 const currency=plan?.currency??"JPY",scale=currency==="USD"?100:1;
 const cash=(v:number)=>new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency,maximumFractionDigits:currency==="JPY"?0:2}).format(v);
 const number=(v:string,max:number,money=false)=>/^\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max&&
  (money?Math.abs(Math.round(Number(v)*scale)/scale-Number(v))<1e-9:Math.round(Number(v)*10)/10===Number(v));
 const valid=number(holding,1e12/scale,true)&&number(drop,100)&&number(stock,Number(holding),true)&&number(rise,1000);
 const p=plan?{currency,monthlyExpenses:plan.monthlyLivingCost/scale,tolerableLoss:(plan.toleranceDrop??0)/scale,singleStockCapPct:plan.perStockCapPct,buyLines:plan.buyLines.map(l=>({...l,amount:l.amount/scale}))}:null;
 const loss=p&&number(holding,1e12/scale,true)&&number(drop,100)?simulateDrop(p,Number(holding),Number(drop)):null;
 const up=p&&valid?simulateSurge(p,[{name:"stock",value:Number(stock)},{name:"rest",value:Number(holding)-Number(stock)}],0,{stock:Number(rise)}):null;
 return <div className={styles.section}><section className={styles.card}><span className={styles.eyebrow}>02 / SIMULATION</span>
  <h1>{t("下落と急騰を、数字で確かめる。","See what a drop or rally would mean.")}</h1>
  <p className={styles.muted}>{t("入力した前提での計算です。将来の予測ではありません。入力は保存しません。","These calculations use your assumptions. They are not forecasts. Inputs are not saved.")}</p>
  {state!=="ready"?<p role="status">{state==="loading"?t("保存済みの計画を読み込んでいます…","Loading your saved plan…"):state==="empty"?t("先にルールを保存してください。","Save your rules first."):t("計画を読み込めませんでした。","Couldn’t load your plan.")}</p>:null}
  {state==="error"?<button className={styles.secondary} onClick={()=>{setState("loading");setAttempt(n=>n+1);}}>{t("再読込","Try again")}</button>:null}
  {plan?<><label className={styles.field}>{t("保有想定額","Assumed portfolio value")} ({currency})<input type="number" min="0" max={1e12/scale} step={1/scale} value={holding} onChange={e=>setHolding(e.target.value)}/></label>
   <label className={styles.field}>{t("下落率","Drop")} (%)<input type="number" min="0" max="100" step="0.1" value={drop} onChange={e=>setDrop(e.target.value)}/></label>
   {loss?<div className={styles.ruleCard} aria-live="polite"><h2>{t("下落した場合","After a drop")}</h2><p>{t("減る金額","Loss")}: {cash(loss.lossAmount)}</p><p>{t("残る評価額","Remaining value")}: {cash(loss.valueAfter)}</p>
    <p>{plan.toleranceDrop===null?t("許容できる下落額は未設定です。","Your loss limit is not set."):loss.withinTolerance?t("許容できる下落額の範囲内です。","Within your loss limit."):t("許容できる下落額を超えています。","Above your loss limit.")}</p>
    {loss.monthsOfExpenses!==null?<p>{t("生活費","Living expenses")}: {loss.monthsOfExpenses} {t("か月分","months")}</p>:null}
    <p>{t("到達したラインの買い増し予定額","Planned purchases at reached levels")}: {cash(loss.plannedBuyTotal)}</p>
   </div>:<p className={styles.error}>{t("金額と0〜100%の下落率を入力してください。","Enter an amount and a drop between 0% and 100%.")}</p>}
   <hr className={styles.divider}/><label className={styles.field}>{t("うち1銘柄の保有額","Amount in one stock")} ({currency})<input type="number" min="0" max={holding} step={1/scale} value={stock} onChange={e=>setStock(e.target.value)}/></label>
   <label className={styles.field}>{t("その銘柄だけの上昇率","Rise in that stock alone")} (%)<input type="number" min="0" max="1000" step="0.1" value={rise} onChange={e=>setRise(e.target.value)}/></label>
   {up?<div className={styles.ruleCard} aria-live="polite"><h2>{t("急騰した場合","After a rally")}</h2><p>{t("全体の評価額","Portfolio value")}: {cash(up.totalAfter)}</p><p>{t("その銘柄の割合","Share in that stock")}: {up.items[0].sharePct}%</p><p>{up.items[0].overCap?t("1銘柄の上限を超えています。","Above your limit per stock."):t("1銘柄の上限内です。","Within your limit per stock.")}</p></div>:<p className={styles.muted}>{t("保有想定額以下の銘柄金額と、0〜1,000%の上昇率を入力してください。","Enter a stock amount no larger than your portfolio and a rise from 0% to 1,000%.")}</p>}
  </>:null}
  <Link href="/resolute" prefetch={false} className={styles.secondary}>{t("① ルール診断へ戻る","① Back to your rules")}</Link>
 </section></div>;
}
