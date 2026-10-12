"use client";
import { ReviewLink as Link, usePlanClient, useNotificationClient, useReview } from "./review-context";
import { useEffect,useRef,useState, type CSSProperties } from "react";
import ToolShell from "./tool-shell";
import NumberInput from "./number-input";
import FlowNavigation from "./flow-navigation";
import styles from "./diagnosis.module.css";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import type { PlanInput } from "@/lib/resolute/plan-data";
import { PlanClientError } from "@/lib/resolute/plan-client";
import { DELIVERY_HOURS,defaultNotificationSettings,parseNotificationSettings,type NotificationSettings,type NotificationSnapshot } from "@/lib/resolute/notification-settings";
import { NotificationClientError } from "@/lib/resolute/notification-client";
import { judge } from "@/lib/resolute/alert-judge";
import { renderAlertMail,renderNextMorningMail } from "@/lib/resolute/mail-templates";

const tips={
 ja:{done:"計画どおりに動けた夜は、そのまま記録しておく価値があります。ルールに書いたことと実際にやったことが同じだったか、1行だけ見直してみてください。次の下落でも、迷いにくくなります。",skipped:"見送ることも、ルールの中の選択肢のひとつです。見送った理由が「買わない条件」に入っているか確かめてみてください。入っていなければ、足しておくと次に迷いません。",unsure:"迷っているのは、ルールとその夜の気持ちがずれているサインかもしれません。急いで決めなくて大丈夫です。計画を開いて、ラインと買い増しの額をもう一度読んでみてください。"},
 en:{done:"Sticking to your plan is worth noting. Write one line about whether your actions matched your rules. It can make the next drop easier to face.",skipped:"Holding off is a choice too. Check whether your reason is already in your conditions for not buying. If not, add it so you have a clearer rule next time.",unsure:"Feeling unsure may mean your rules and how you felt didn't quite match. There's no rush. Open your plan and reread your buy levels and amounts."}
};
export default function NotificationScreen({identityReady=true,mode}:{identityReady?:boolean;mode:"alerts"|"morning"}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><Notifications locale={locale} deny={deny} mode={mode}/>}</ToolShell>;
}
function Notifications({locale,deny,mode}:{locale:DiagnosisLocale;deny:()=>void;mode:"alerts"|"morning"}) {
 const requestPlan = usePlanClient();
 const reviewPath=useReview()?.path;
 const requestNotificationSettings = useNotificationClient();
 const [snapshot,setSnapshot]=useState<NotificationSnapshot|null>(null),[draft,setDraft]=useState<NotificationSettings>(defaultNotificationSettings);
 const [plan,setPlan]=useState<PlanInput|null>(null),[planState,setPlanState]=useState("loading"),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[attempt,setAttempt]=useState(0);
 const [timeOpen,setTimeOpen]=useState(false);
 const [message,setMessage]=useState(""),[change,setChange]=useState(-25),[pick,setPick]=useState<"done"|"skipped"|"unsure"|null>(null);
 const controllerRef=useRef<AbortController|null>(null),mutex=useRef(false),denyRef=useRef(deny);
 useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{const c=new AbortController();controllerRef.current=c;
  void Promise.allSettled([requestNotificationSettings(undefined,c.signal),requestPlan(undefined,c.signal)]).then(([settings,planResult])=>{
   if(c.signal.aborted)return;
   if(settings.status==="fulfilled"){setSnapshot(settings.value);setDraft(settings.value.settings);setLocked(false);setMessage("");}
   else {if(settings.reason instanceof NotificationClientError&&[401,403].includes(settings.reason.status)){denyRef.current();return;}setMessage("unavailable");setLocked(true);}
   if(planResult.status==="fulfilled"){setPlan(planResult.value.plan);setPlanState(planResult.value.plan?"ready":"empty");}
   else {if(planResult.reason instanceof PlanClientError&&["signed-out","denied"].includes(planResult.reason.kind)){denyRef.current();return;}setPlanState("error");}
   setLoading(false);
  });return()=>c.abort();
 },[attempt,requestPlan,requestNotificationSettings]);
 // Refresh rules after an edited diagnosis, without discarding unsaved settings.
 useEffect(()=>{
  if(reviewPath!=="/resolute/alerts"&&reviewPath!=="/resolute/morning")return;
  const c=new AbortController();
  void requestPlan(undefined,c.signal).then(result=>{if(!c.signal.aborted){setPlan(result.plan);setPlanState(result.plan?"ready":"empty");}},error=>{
   if(c.signal.aborted)return;
   if(error instanceof PlanClientError&&["signed-out","denied"].includes(error.kind))denyRef.current();else setPlanState("error");
  });
  return()=>c.abort();
 },[reviewPath,requestPlan]);
 const en=locale==="en",t=(ja:string,eng:string)=>en?eng:ja,isMorning=mode==="morning";
 function update(patch:Partial<NotificationSettings>){setDraft(s=>({...s,...patch}));setMessage("");}
 async function save(){
  if(mutex.current||!snapshot||locked)return;
  let settings:NotificationSettings;try{settings=parseNotificationSettings(draft);}catch{setMessage("invalid");return;}
  mutex.current=true;setBusy(true);setMessage("");const c=new AbortController();controllerRef.current=c;
  try{const result=await requestNotificationSettings({settings,baseRevision:snapshot.revision},c.signal);if(!c.signal.aborted){setSnapshot(result);setDraft(result.settings);setMessage("saved");}}
  catch(e){if(c.signal.aborted)return;if(e instanceof NotificationClientError&&[401,403].includes(e.status)){denyRef.current();return;}
   setLocked(true);setMessage(e instanceof NotificationClientError&&e.status===409?"conflict":"uncertain");}
  finally{mutex.current=false;if(!c.signal.aborted)setBusy(false);}
 }
 useEffect(()=>()=>controllerRef.current?.abort(),[]);
 const messages:Record<string,string>={unavailable:t("通知設定を読み込めませんでした。まだ保存できません。","Couldn’t load your notification settings. Saving is unavailable."),invalid:t("銘柄と基準価格、上昇率を確認してください。","Check your symbols, reference prices and upside marker."),saved:t("通知設定を保存しました。","Your notification settings are saved."),conflict:t("別の画面で設定が変わりました。保存済みの設定を読み込み、確認してください。","Your settings changed in another window. Load the saved settings and review them."),uncertain:t("保存を確認できませんでした。再送する前に、保存済みの設定を読み込んでください。","We couldn’t confirm the save. Load your saved settings before trying again.")};
 const lines=plan?.buyLines.map(l=>l.dropPct)??[];
 const validItems=draft.watchItems.filter(i=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(i.symbol)&&Number.isFinite(i.referencePrice)&&i.referencePrice>0&&i.referencePrice<=1000000);
 const watch=validItems.map(i=>({...i,lines,renotifyAfterRecovery:false,...(draft.surgeCapPct===null?{}:{surgeCapPct:draft.surgeCapPct})}));
 const events=judge(watch,watch.map(i=>({symbol:i.symbol,date:"2027-02-03",close:Math.max(0.01,Math.round(i.referencePrice*(100+change))/100),isFinal:true})),{}).events;
 const mail=events.length?renderAlertMail({locale,date:"2027-02-03",items:events,planUrl:"/resolute",unsubscribeUrl:"/resolute/alerts"}):null;
 const morningMail=renderNextMorningMail({locale,doneUrl:"/resolute/morning",skippedUrl:"/resolute/morning",unsureUrl:"/resolute/morning",planUrl:"/resolute",unsubscribeUrl:"/resolute/morning"});
 const usd=(v:number)=>new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:"USD"}).format(v);
 const timeButtons=<div className={styles.timeGrid}>{DELIVERY_HOURS.map(h=><button type="button" key={h} aria-pressed={draft.deliveryHourJst===h} onClick={()=>update({deliveryHourJst:h})}>{h}:00</button>)}</div>;
 const mailExample=(example:{subject:string;text:string})=><div className={styles.mailPreview}><div className={styles.mailSubject}>{en?example.subject:example.subject.split(/(【RESOLUTE】|あなたの計画の|ラインに|ラインと|上昇の目安に|届いた銘柄があります|昨日のお知らせのあと、|どうでしたか\?)/).filter(Boolean).map((part,i)=><span className={styles.phrase} key={i}>{part}</span>)}</div><pre className={styles.mailText}>{example.text}</pre></div>;
 const lineColors=["#ecd48f","#eba85a","#e5744f","#cf4a52","#b03a62"];
 const picks=[t("計画どおり動いた","I followed my plan"),t("見送った","I held off"),t("まだ迷っている","I'm still unsure")];
 return <div className={styles.section}>
  <header className={styles.toolHeading}><h1>{isMorning?t("翌朝のひとこと","Morning note"):t("終値アラート","Closing-price alerts")}</h1><p className={styles.muted}>{isMorning?t("お知らせの翌朝に、1通だけ届きます","One short email the morning after an alert"):t("ラインに届いた日に、メールでお知らせ","An email when the closing price reaches a level in your plan")}</p></header>
  {loading?<p role="status">{t("設定を読み込んでいます…","Loading your settings…")}</p>:null}
  <fieldset className={styles.settingsFields} disabled={loading||busy||locked}>
   {isMorning?<section className={styles.card}>
    <label className={styles.switchRow}><span>{en?"Get the morning note":<><span className={styles.phrase}>翌朝のひとことを</span><span className={styles.phrase}>受け取る</span></>}</span><input type="checkbox" role="switch" checked={draft.morningEnabled} onChange={e=>update({morningEnabled:e.target.checked})}/></label>
    <p className={styles.muted}>{t("初めはオフです。オンにすると、お知らせと同じ時間に届きます。","Off by default. Turn it on to receive a note at the same time as your alerts.")}</p>
    <div className={styles.deliveryRow}><span>{draft.deliveryHourJst}:00 <small>{t("日本時間","JST")}</small></span><button type="button" className={styles.timeEdit} aria-expanded={timeOpen} aria-controls="morning-delivery-time" onClick={()=>setTimeOpen(v=>!v)}>{t("届く時間を変更する","Change delivery time")}</button></div>
    {timeOpen?<div id="morning-delivery-time">{timeButtons}</div>:null}
   </section>:<>
    <section className={styles.card}><h2>{t("見る銘柄","Stocks to watch")}</h2>
     {draft.watchItems.map((item,i)=><div className={styles.stockRow} key={i}>
      <input className={styles.symbolInput} aria-label={t("銘柄","Symbol")+` ${i+1}`} placeholder={t("銘柄","Symbol")} type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={15} value={item.symbol} onChange={e=>update({watchItems:draft.watchItems.map((x,k)=>k===i?{...x,symbol:e.target.value.toUpperCase().trim()}:x)})}/>
      <label className={styles.referencePrice}><span>{t("基準","Reference")}</span><span className={styles.dollarInput}><i>$</i><NumberInput aria-label={t("基準価格","Reference price")+` ${i+1}`} decimal value={item.referencePrice||""} onValueChange={value=>update({watchItems:draft.watchItems.map((x,k)=>k===i?{...x,referencePrice:value===""?0:Number(value)}:x)})}/></span></label>
      <button type="button" className={styles.removeButton} aria-label={t("銘柄を削除","Remove symbol")+` ${i+1}`} onClick={()=>update({watchItems:draft.watchItems.filter((_,k)=>k!==i)})}>×</button>
     </div>)}
     {draft.watchItems.length<5?<button type="button" className={styles.addButton} onClick={()=>update({watchItems:[...draft.watchItems,{symbol:"",referencePrice:0}]})}>{t("＋ 銘柄を追加","＋ Add a stock")}</button>:null}
    </section>
    <section className={styles.card}><h2>{t("知らせるライン","Alert lines")}</h2><p className={styles.muted}>{t("あなたのルールの買い増しラインです","These are the buy-more lines from your rules")}</p>
     {lines.length?<div className={styles.lineChips}>{lines.map(l=><span key={l}>−{l}%</span>)}</div>:<p className={styles.muted}>{planState==="error"?t("保存済みのラインを読み込めませんでした。","Couldn’t load your saved levels."):t("買い増しラインはまだ設定されていません。","No purchase levels are set yet.")}</p>}
     <label className={styles.switchRow}><span>{t("上昇の目安も知らせる","Also alert me on a rise")}</span><input type="checkbox" role="switch" checked={draft.surgeCapPct!==null} onChange={e=>update({surgeCapPct:e.target.checked?50:null})}/></label>
     {draft.surgeCapPct!==null?<label className={styles.compactField}><span>{t("基準からの上昇率","Rise from reference")}</span><span><NumberInput decimal value={draft.surgeCapPct} onValueChange={value=>update({surgeCapPct:Number(value)})}/> %</span></label>:null}
    </section>
    <section className={styles.card}><h2>{t("届く時間","Delivery time")}</h2><p className={styles.muted}>{t("前の夜の終値をもとに、この時間にお知らせします(日本時間)","We check the previous night’s closing prices and send alerts at this time in Japan (JST)")}</p>{timeButtons}
     <label className={styles.switchRow}><span>{t("終値アラートを受け取る","Receive closing-price alerts")}</span><input type="checkbox" role="switch" checked={draft.alertsEnabled} onChange={e=>update({alertsEnabled:e.target.checked})}/></label>
    </section>
   </>}
   <button type="button" className={styles.primary} onClick={()=>void save()} disabled={!snapshot||busy||loading||locked}>{busy?t("保存しています…","Saving…"):t("通知設定を保存する","Save notification settings")}</button>
  </fieldset>
  {snapshot&&JSON.stringify(snapshot.settings)!==JSON.stringify(draft)?<p className={styles.status}>{t("変更はまだ保存していません。","You have unsaved changes.")}</p>:null}
  {message?<p role="status" className={message==="saved"?styles.status:styles.error}>{messages[message]}</p>:null}
  {locked?<button className={styles.secondary} disabled={busy||loading} onClick={()=>{setLoading(true);setAttempt(v=>v+1);}}>{t("保存済みの設定を読み込む（現在の入力を置き換えます）","Load saved settings (replaces your current changes)")}</button>:null}
  {isMorning?<>
   {!draft.morningEnabled?<section className={`${styles.card} ${styles.hero}`}><p className={styles.muted}>{snapshot?t("通知を受け取らない設定です。","Notifications are turned off."):t("保存済みの設定はまだ確認できていません。","Your saved settings have not been confirmed.")}</p></section>:<section className={`${styles.card} ${styles.hero}`}>
    <span className={styles.eyebrow}>GOOD MORNING</span>
    <p className={styles.morningQuestion}>{en?"Quick check-in on yesterday's alert.":<><span className={styles.phrase}>昨日のお知らせから、</span><span className={styles.phrase}>一晩たちました。</span></>}</p>
    <p className={styles.muted}>{en?"Pick whichever feels closest right now.":<><span className={styles.phrase}>いまの気持ちに近いものを、</span><span className={styles.phrase}>1つだけ選んでください。</span></>}</p>
    {pick?<div className={styles.morningAnswer}><div className={`${styles.verdict} ${styles.verdictOk}`}><strong>{picks[(["done","skipped","unsure"] as const).indexOf(pick)]}</strong><span>{t("どれを選んでも、正解・不正解はありません。","There are no right or wrong answers.")}</span></div><p>{tips[locale][pick]}</p><Link href="/resolute" className={styles.primary} prefetch={false}>{t("計画を開く","Open your plan")}</Link><button className={styles.ghost} onClick={()=>setPick(null)}>{t("選び直す","Choose again")}</button></div>:<><div className={styles.options}>{(["done","skipped","unsure"] as const).map((k,i)=><button key={k} className={styles.option} onClick={()=>setPick(k)}>{picks[i]}</button>)}</div><p className={styles.disclaimer}>{t("このメールは、昨日のお知らせについて1回だけ届きます。","We send this once per alert.")}</p></>}
   </section>}
   {draft.morningEnabled?<details className={`${styles.card} ${styles.disclosure}`}><summary>{t("届くメールの例","Example email")}</summary>{mailExample(morningMail)}</details>:null}
  </>:<section className={`${styles.card} ${styles.hero}`}>
    <span className={styles.eyebrow}>LINES</span><h2 className={styles.linesTitle}>{t("あなたのライン","Your lines")}</h2>
    <div className={styles.alertLines}>{validItems.map(item=><div className={styles.stockLines} key={item.symbol}><strong>{item.symbol}</strong>{lines.map((l,i)=><div className={styles.priceLine} key={l} style={{"--line-color":lineColors[Math.min(i,lineColors.length-1)]} as CSSProperties}><span>−{l}%</span><b>{usd(item.referencePrice*(100-l)/100)}</b></div>)}{draft.surgeCapPct!==null?<div className={styles.priceLine} style={{"--line-color":"#8fd6a8"} as CSSProperties}><span>+{draft.surgeCapPct}%</span><b>{usd(item.referencePrice*(100+draft.surgeCapPct)/100)}</b></div>:null}</div>)}</div>
    {!validItems.length?<p className={styles.muted}>{t("銘柄と基準価格を入れてください","Enter a symbol and reference price")}</p>:null}
    <hr className={styles.divider}/><span className={styles.eyebrow}>TRY IT</span><p className={styles.muted}>{t("もしも、ある日の終値が基準から","What if a closing price moved")}</p><p className={styles.percentNumber}>{change>=0?"+":"−"}{Math.abs(change)}%</p><p className={styles.muted}>{t("だったら？","from your reference?")}</p><input type="range" min="-50" max="100" value={change} aria-label={t("終値の変化","Closing-price change")} onChange={e=>setChange(Number(e.target.value))}/>
    <details className={styles.mailDetails}><summary>{t("届くメールの例を見る","See an example email")}</summary>{mail?mailExample(mail):<p className={styles.muted}>{t("この条件では通知に該当しません。","This scenario would not trigger an alert.")}</p>}</details>
   </section>}
  {!isMorning?<p className={styles.disclaimer}>{t("通知は、米国市場の終値が確定したあとに送ります。","Alerts are sent after US closing prices are final.")}<br/>{t("情報の提供であり、投資助言ではありません。","This is information, not investment advice.")}</p>:null}
  <p className={styles.disclaimer}>{t("メール配信は準備中です。この画面の試算でメールは送信されません。","Email delivery is being prepared. Trying this screen does not send an email.")}</p>
  <FlowNavigation step={isMorning?4:3} locale={locale}/>
 </div>;
}
