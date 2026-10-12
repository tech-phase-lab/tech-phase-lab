"use client";
import { ReviewLink as Link, usePlanClient } from "../review-context";
import { useEffect,useRef,useState } from "react";
import ToolShell from "../tool-shell";
import NumberInput from "../number-input";
import {scaledNumberInput} from "@/lib/resolute/number-input";
import FlowNavigation from "../flow-navigation";
import styles from "../diagnosis.module.css";
import { PlanClientError } from "@/lib/resolute/plan-client";
import type { PlanInput } from "@/lib/resolute/plan-data";
import { simulateDrop,simulateSurge } from "@/lib/resolute/simulate";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
export default function SimulationScreen({identityReady=true}:{identityReady?:boolean}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><Simulation locale={locale} deny={deny}/>}</ToolShell>;
}
function Simulation({locale,deny}:{locale:DiagnosisLocale;deny:()=>void}) {
 const requestPlan = usePlanClient();
 const [plan,setPlan]=useState<PlanInput|null>(null),[state,setState]=useState("loading"),[attempt,setAttempt]=useState(0);
 const [holding,setHolding]=useState("0"),[drop,setDrop]=useState("30"),[rise,setRise]=useState("30");
 const [holdings,setHoldings]=useState(()=>Array.from({length:3},()=>({name:"",value:"0"})));
 const [tab,setTab]=useState<"drop"|"surge">("drop");
 const denyRef=useRef(deny);useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{const controller=new AbortController();
  void requestPlan(undefined,controller.signal).then(p=>{if(controller.signal.aborted)return;
   setPlan(p.plan);setState(p.plan?"ready":"empty");
   if(p.plan){setHolding("0");setHoldings(Array.from({length:3},()=>({name:"",value:"0"})));}
  },e=>{if(controller.signal.aborted)return;if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind))denyRef.current();else setState("error");});
  return()=>controller.abort();},[attempt,requestPlan]);
 const en=locale==="en",t=(ja:string,eng:string)=>en?eng:ja;
 const currency=plan?.currency??"JPY",scale=currency==="USD"?100:1;
 const unit=currency==="JPY"?10000:1,unitLabel=currency==="JPY"?t("万円","× ¥10,000"):"USD";
 const cash=(v:number)=>{
  if(!en&&currency==="JPY") {const n=Math.floor(v),m=Math.floor(n/10000),r=n%10000;return n>=10000?(r?`${m.toLocaleString("ja-JP")}万${r.toLocaleString("ja-JP")}円`:`${m.toLocaleString("ja-JP")}万円`):`${n.toLocaleString("ja-JP")}円`;}
  return new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency,maximumFractionDigits:currency==="JPY"?0:2}).format(v);
 };
 const minor=(value:string)=>scaledNumberInput(value,currency==="JPY"?4:2);
 const amount=(value:string)=>(minor(value)??NaN)/scale;
 const number=(v:string,max:number,money=false)=>/^\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max&&
  (money?Math.abs(Math.round(Number(v)*scale)/scale-Number(v))<1e-9:Math.round(Number(v)*10)/10===Number(v));
 const rulesValid=plan!==null&&[plan.monthlyLivingCost,plan.toleranceDrop??0].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12)&&number(String(plan.perStockCapPct),100)&&plan.buyLines.every((l,i)=>number(String(l.dropPct),99.9)&&l.dropPct>0&&Number.isSafeInteger(l.amount)&&l.amount>=0&&l.amount<=1e12&&(i===0||plan.buyLines[i-1].dropPct<l.dropPct));
 const valid=rulesValid&&holdings.every(h=>minor(h.value)!==null)&&number(rise,1000);
 const p=plan?{currency,monthlyExpenses:plan.monthlyLivingCost/scale,tolerableLoss:(plan.toleranceDrop??0)/scale,singleStockCapPct:plan.perStockCapPct,buyLines:plan.buyLines.map(l=>({...l,amount:l.amount/scale}))}:null;
 const loss=p&&rulesValid&&minor(holding)!==null&&number(drop,100)?simulateDrop(p,amount(holding),Number(drop)):null;
 const up=p&&valid?simulateSurge(p,holdings.map((h,i)=>({name:`holding-${i}`,value:amount(h.value)})),Number(rise)):null;
 const stockName=(i:number)=>holdings[i].name.trim()||t(`銘柄${String.fromCharCode(65+i)}`,`Stock ${String.fromCharCode(65+i)}`);
 const holdingField=(label:string,value:string,onValueChange:(v:string)=>void)=><label className={styles.compactField}><span>{label}</span><span><NumberInput decimal value={value} onValueChange={onValueChange}/><small>{unitLabel}</small></span></label>;
 return <div className={styles.section}>
  <header className={styles.toolHeading}><h1>{t("資産額シミュレーション","Portfolio simulator")}</h1></header>
  <p className={styles.muted}>{t("相場が上下に急変動したら資産はどれぐらい動くのか？現在の保有額を入れて実際に検証してみましょう。将来の予測ではありません。","How would a sudden market drop or rally affect your portfolio? Enter your current holdings and try it out. This is not a forecast.")}</p>
  {state!=="ready"?<section className={styles.card}><p role="status">{state==="loading"?t("保存済みの計画を読み込んでいます…","Loading your saved plan…"):state==="empty"?t("先にルールを保存してください。","Save your rules first."):t("計画を読み込めませんでした。","Couldn’t load your plan.")}</p>
   {state==="error"?<button className={styles.secondary} onClick={()=>{setState("loading");setAttempt(n=>n+1);}}>{t("再読込","Try again")}</button>:null}
   <Link href="/resolute" prefetch={false} className={styles.secondary}>{t("① ルール診断へ戻る","① Back to your rules")}</Link>
  </section>:null}
  {plan?<>
   <div className={styles.tabs} role="group" aria-label={t("試算の種類","Scenario")}><button aria-pressed={tab==="drop"} onClick={()=>setTab("drop")}>{t("下落時","If it falls")}</button><button aria-pressed={tab==="surge"} onClick={()=>setTab("surge")}>{t("上昇時","If it rises")}</button></div>
   <section className={styles.card}>
    <div className={styles.scenario}><p className={styles.muted}>{t("もしも、持っている株が",tab==="drop"?"What if your stocks fell":"What if your stocks rose")}</p><p className={styles.percentNumber}>{tab==="drop"?"−"+drop:"+"+rise}%</p><p className={styles.muted}>{t(tab==="drop"?"下がったら？":"上がったら？","from their current value?")}</p></div>
    <input type="range" min="0" max={tab==="drop"?100:200} step="1" value={tab==="drop"?drop:Math.min(200,Number(rise))} aria-label={t(tab==="drop"?"下落率のスライダー":"上昇率のスライダー",tab==="drop"?"Drop slider":"Rise slider")} onChange={e=>tab==="drop"?setDrop(e.target.value):setRise(e.target.value)}/>
    <div className={styles.chips}>{(tab==="drop"?[10,20,30,50]:[10,30,50,100]).map(v=><button key={v} aria-pressed={Number(tab==="drop"?drop:rise)===v} onClick={()=>tab==="drop"?setDrop(String(v)):setRise(String(v))}>{tab==="drop"?"−":"+"}{v}%</button>)}</div>
    {tab==="drop"?holdingField(t("いまの保有額","Current holdings"),holding,setHolding):<div className={styles.section}>
     <p className={styles.muted}>{t("いまの保有","Current holdings")}</p>
     {holdings.map((h,i)=><div className={styles.holdingRow} key={i}><input aria-label={t("銘柄名","Stock name")+` ${i+1}`} type="text" maxLength={40} placeholder={stockName(i)} value={h.name} onChange={e=>setHoldings(hs=>hs.map((x,k)=>k===i?{...x,name:e.target.value}:x))}/><label className={styles.amountWithUnit}><NumberInput aria-label={t("保有額","Holding value")+` ${i+1}`} decimal value={h.value} onValueChange={value=>setHoldings(hs=>hs.map((x,k)=>k===i?{...x,value}:x))}/><small>{unitLabel}</small></label></div>)}
    </div>}
   </section>
   {tab==="drop"?(loss?<section className={`${styles.card} ${styles.hero}`} aria-live="polite"><span className={styles.eyebrow}>RESULT</span><p className={styles.muted}>{t("あなたの資産は","Your portfolio would fall by")}</p><p className={styles.bigNumber}>{cash(loss.lossAmount)}{en?"":"減ります"}</p>
    {loss.monthsOfExpenses!==null?<p className={styles.muted}>{t(`生活費の${loss.monthsOfExpenses}か月分です`,`That's ${loss.monthsOfExpenses} months of living costs`)}</p>:null}
    <div className={styles.resultStack}>
     <div className={`${styles.verdict} ${loss.withinTolerance?styles.verdictOk:styles.verdictWarning}`}><strong>{Number(holding)===0?t("保有額を入力して確かめましょう。","Enter your holdings to try it out."):plan.toleranceDrop===null?t("許容できる下落額は未設定です。","Your loss limit is not set."):loss.withinTolerance?(en?"Within your loss limit":<><span className={styles.phrase}>許容できる下落額の</span><span className={styles.phrase}>範囲内です</span></>):(en?"Above your loss limit":<><span className={styles.phrase}>許容できる下落額を</span><span className={styles.phrase}>超えています</span></>)}</strong>
      {plan.toleranceDrop!==null&&Number(holding)>0?<span>{loss.withinTolerance?t(`許容額まで、あと${cash(plan.toleranceDrop/scale-loss.lossAmount)}の余裕があります。`,`You have ${cash(plan.toleranceDrop/scale-loss.lossAmount)} left before your limit.`):t(`許容額を${cash(loss.lossAmount-plan.toleranceDrop/scale)}超えます。ルールを読み直す目安です。`,`This is ${cash(loss.lossAmount-plan.toleranceDrop/scale)} over your limit. A cue to reread your rules.`)}</span>:null}
     </div>
     {plan.buyLines.map(l=><div key={l.dropPct} className={styles.valueRow} data-reached={Number(drop)>=l.dropPct}><span><i className={styles.reachedBadge}>{Number(drop)>=l.dropPct?t("到達","Reached"):t("まだ先","Not reached")}</i>−{l.dropPct}%</span><strong>{cash(l.amount/scale)}</strong></div>)}
     <p className={styles.muted}>{t("到達したラインの買い増し予定額","Planned purchases at reached levels")}: {cash(loss.plannedBuyTotal)}</p>
    </div>
   </section>:<p className={styles.error}>{t("金額とルールの数値を確認してください。","Check your amounts and saved-rule inputs.")}</p>):(up?<section className={`${styles.card} ${styles.hero}`} aria-live="polite"><span className={styles.eyebrow}>RESULT</span><p className={styles.muted}>{t("あなたの資産は","Your holdings after the rise")}</p><p className={styles.bigNumber}>{en?cash(up.totalAfter):`合計${cash(up.totalAfter)}になります`}</p>
    <div className={styles.resultStack}><div className={`${styles.verdict} ${up.overCapNames.length?styles.verdictWarning:styles.verdictOk}`}><strong>{up.totalAfter===0?t("保有額を入力して確かめましょう。","Enter your holdings to try it out."):up.overCapNames.length?t("1銘柄の上限を超える銘柄があります","Some holdings exceed your single-stock cap"):t("すべて上限の範囲内です","All within your single-stock cap")}</strong><span>{t(`1銘柄の上限は${plan.perStockCapPct}%です。`,`Your single-stock cap is ${plan.perStockCapPct}%.`)}</span></div>
     {up.items.map((item,i)=><div className={styles.shareCard} key={i}><div className={styles.shareCaption}><strong>{stockName(i)}</strong><span>{item.sharePct}%</span></div><div className={styles.shareTrack}><span data-over={item.overCap} style={{width:`${Math.min(100,item.sharePct)}%`}}/><i style={{left:`${plan.perStockCapPct}%`}}/></div><span>{cash(item.valueAfter)}</span></div>)}<p className={styles.disclaimer}>{t("縦の線が、1銘柄の上限です。","The vertical line is your single-stock cap.")}</p>
    </div>
   </section>:<p className={styles.error}>{t("金額とルールの数値を確認してください。","Check your amounts and saved-rule inputs.")}</p>)}
   <details className={`${styles.card} ${styles.disclosure}`}><summary>{t("あなたのルール","Your rules")}</summary><div className={styles.section}>
    <p className={styles.muted}>{t("診断の結果が自動で入ります。ここでの変更は試算だけに使い、保存しません。","Your diagnosis fills these in. Changes here apply only to this simulation and are not saved.")}</p>
    {holdingField(t("毎月の生活費","Monthly living costs"),String(plan.monthlyLivingCost/scale/unit),v=>setPlan({...plan,monthlyLivingCost:minor(v)??NaN}))}
    {holdingField(t("許容できる下落","Tolerable loss"),plan.toleranceDrop===null?"":String(plan.toleranceDrop/scale/unit),v=>setPlan({...plan,toleranceDrop:v===""?null:minor(v)??NaN}))}
    <label className={styles.compactField}><span>{t("1銘柄の上限","Single-stock cap")}</span><span><NumberInput decimal value={plan.perStockCapPct} onValueChange={v=>setPlan({...plan,perStockCapPct:Number(v)})}/> %</span></label>
    {tab==="drop"?plan.buyLines.map((l,i)=><div className={styles.ruleLineEdit} key={i}><span>{t(`${i+1}段階目`,`Level ${i+1}`)}</span><label><NumberInput aria-label={t("下落ライン","Drop level")+` ${i+1}`} decimal value={l.dropPct} onValueChange={v=>setPlan({...plan,buyLines:plan.buyLines.map((x,k)=>k===i?{...x,dropPct:Number(v)}:x)})}/> %</label><label><NumberInput aria-label={t("買い増し額","Purchase amount")+` ${i+1}`} decimal value={l.amount/scale/unit} onValueChange={v=>setPlan({...plan,buyLines:plan.buyLines.map((x,k)=>k===i?{...x,amount:minor(v)??NaN}:x)})}/> {unitLabel}</label></div>):null}
   </div></details>
  </>:null}
  <FlowNavigation step={2} locale={locale}/>
 </div>;
}
