"use client";
import { usePlanClient, useNotificationClient, useReview } from "./review-context";
import { useEffect,useRef,useState, type CSSProperties } from "react";
import ToolShell from "./tool-shell";
import { useUnsavedChanges } from "./use-unsaved-changes";
import StockInput from "./stock-input";
import NumberInput from "./number-input";
import FlowNavigation from "./flow-navigation";
import { useRemembered } from "./features/use-remembered";
import styles from "./diagnosis.module.css";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import {questions,questionCopy} from "@/lib/resolute/diagnosis-form";
import type { PlanInput, PlanSnapshot } from "@/lib/resolute/plan-data";
import { PlanClientError } from "@/lib/resolute/plan-client";
import { DELIVERY_HOURS,defaultNotificationSettings,parseNotificationSettings,type NotificationSettings,type NotificationSnapshot } from "@/lib/resolute/notification-settings";
import { NotificationClientError } from "@/lib/resolute/notification-client";
import { judge } from "@/lib/resolute/alert-judge";
import { resoluteAlertPushBody,resoluteMorningPushBody } from "@/lib/resolute/push-notice";
import { latestAlertFromDigest } from "@/lib/resolute/latest-alert";
import DeviceNotifications from "@/app/research/notification-settings";
import PushSample from "./push-sample";
import { LatestAlertContent } from "./alerts/latest/screen";
import { deliveryClock,deliveryZone } from "@/lib/resolute/delivery-time";
import { ruleFacts } from "@/lib/resolute/plan-rules";
import pc from "./pc.module.css";
import { useDesktop,useTouchDevice } from "./use-desktop";

const tips={
 ja:{done:"計画どおりに動けた夜は、そのまま記録しておく価値があります。ルールに書いたことと実際にやったことが同じだったか、1行だけ見直してみてください。次の下落でも、迷いにくくなります。",skipped:"見送ることも、ルールの中の選択肢のひとつです。見送った理由が「買わない条件」に入っているか確かめてみてください。入っていなければ、足しておくと次に迷いません。",unsure:"迷っているのは、ルールとその夜の気持ちがずれているサインかもしれません。急いで決めなくて大丈夫です。計画を開いて、ラインと買い増しの額をもう一度読んでみてください。"},
 en:{done:"You stuck to your plan. Take a moment to record it. Write one line about whether your actions matched your rules. It can make the next drop easier to face.",skipped:"Holding off is a choice too. Check whether your reason is already in your conditions for not buying. If not, add it so you have a clearer rule next time.",unsure:"Feeling unsure may mean your rules and how you felt didn't quite match. There's no rush. Open your plan and reread your purchase levels and amounts."}
};
export default function NotificationScreen({identityReady=true,mode}:{identityReady?:boolean;mode:"alerts"|"morning"}) {
 return <ToolShell identityReady={identityReady} pc>{(locale,deny)=><Notifications locale={locale} deny={deny} mode={mode}/>}</ToolShell>;
}
function Notifications({locale,deny,mode}:{locale:DiagnosisLocale;deny:()=>void;mode:"alerts"|"morning"}) {
 const requestPlan = usePlanClient();
 const desktop=useDesktop(),touch=useTouchDevice();
 const reviewPath=useReview()?.path;
 const requestNotificationSettings = useNotificationClient();
 // Settings and rules already loaded in this tab are shown at once and refreshed behind them (owner, Nov 17).
 const knownSettings=useRemembered<NotificationSnapshot>("notifications"),knownPlan=useRemembered<PlanSnapshot>("plan");
 const [snapshot,setSnapshot]=useState<NotificationSnapshot|null>(knownSettings??null),[draft,setDraft]=useState<NotificationSettings>(()=>knownSettings?.settings??defaultNotificationSettings());
 const [plan,setPlan]=useState<PlanInput|null>(knownPlan?.plan??null),[planState,setPlanState]=useState(knownPlan?(knownPlan.plan?"ready":"empty"):"loading"),[loading,setLoading]=useState(!(knownSettings&&knownPlan)),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[attempt,setAttempt]=useState(0);
 useUnsavedChanges(busy || (!!snapshot && JSON.stringify(draft)!==JSON.stringify(snapshot.settings)));
 const [timeOpen,setTimeOpen]=useState(false),[planOpen,setPlanOpen]=useState(false);
 const planDialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(planOpen)planDialog.current?.showModal();else planDialog.current?.close();},[planOpen]);
 const [message,setMessage]=useState(""),[change,setChange]=useState(-25),[pick,setPick]=useState<"done"|"skipped"|"unsure"|null>(null);
 useEffect(()=>{
  if(mode!=="morning")return;
  let active=true;const value=window.location.hash.slice(1);
  if(value==="done"||value==="skipped"||value==="unsure")queueMicrotask(()=>{if(active)setPick(value);});
  return()=>{active=false;};
 },[mode]);
 const controllerRef=useRef<AbortController|null>(null),mutex=useRef(false),denyRef=useRef(deny);
 useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{const c=new AbortController();controllerRef.current=c;
  void Promise.allSettled([requestNotificationSettings(undefined,c.signal),requestPlan(undefined,c.signal)]).then(([settings,planResult])=>{
   if(c.signal.aborted)return;
   // Changes made while the shown settings were being checked again stay, unless the saved settings themselves changed.
   if(settings.status==="fulfilled"){const keep=attempt===0&&knownSettings?.revision===settings.value.revision;setSnapshot(settings.value);if(!keep)setDraft(settings.value.settings);setLocked(false);setMessage("");}
   else {if(settings.reason instanceof NotificationClientError&&[401,403].includes(settings.reason.status)){denyRef.current();return;}setMessage(settings.reason instanceof NotificationClientError&&settings.reason.status===503?"preparing":"unavailable");setLocked(true);}
   if(planResult.status==="fulfilled"){setPlan(planResult.value.plan);setPlanState(planResult.value.plan?"ready":"empty");}
   else {if(planResult.reason instanceof PlanClientError&&["signed-out","denied"].includes(planResult.reason.kind)){denyRef.current();return;}setPlanState(planResult.reason instanceof PlanClientError&&planResult.reason.kind==="unavailable"?"preparing":"error");}
   setLoading(false);
  });return()=>c.abort();
 },[attempt,requestPlan,requestNotificationSettings,knownSettings]);
 // While saving is not switched on yet, check again quietly; the real screen appears by itself once it is.
 useEffect(()=>{
  if(loading||(message!=="preparing"&&planState!=="preparing"))return;
  const timer=window.setTimeout(()=>setAttempt(v=>v+1),60000);
  return()=>window.clearTimeout(timer);
 },[loading,message,planState,attempt]);
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
 const mailText=t("スマホ通知をオンにしていない場合はメールで届きます","If phone notifications aren’t on, you’ll get an email instead");
 function update(patch:Partial<NotificationSettings>){setDraft(s=>({...s,...patch}));setMessage("");}
 async function save(){
  if(mutex.current||!snapshot||locked)return;
  let settings:NotificationSettings;try{settings=parseNotificationSettings({...draft,watchItems:draft.watchItems.filter(x=>x.symbol.trim()!==""||x.referencePrice!==0)});}catch{setMessage("invalid");return;}
  mutex.current=true;setBusy(true);setMessage("");const c=new AbortController();controllerRef.current=c;
  try{const result=await requestNotificationSettings({settings,baseRevision:snapshot.revision},c.signal);if(!c.signal.aborted){setSnapshot(result);setDraft(result.settings);setMessage("saved");}}
  catch(e){if(c.signal.aborted)return;if(e instanceof NotificationClientError&&[401,403].includes(e.status)){denyRef.current();return;}
   setLocked(true);setMessage(e instanceof NotificationClientError&&e.status===409?"conflict":"uncertain");}
  finally{mutex.current=false;if(!c.signal.aborted)setBusy(false);}
 }
 useEffect(()=>()=>controllerRef.current?.abort(),[]);
 const messages:Record<string,string>={preparing:t("通知の保存は、いま準備中です。準備ができたら、この画面が自動で使えるようになります。","Saving your notification settings isn’t switched on yet. This screen will start working by itself once it is."),unavailable:t("通知設定を読み込めませんでした。まだ保存できません。","We couldn’t load your notification settings, so you can’t save changes yet."),invalid:t("銘柄と基準価格、上昇率を確認してください。","Check your stock symbols, reference prices and rise alert level."),saved:t("通知設定を保存しました。","Your notification settings are saved."),conflict:t("別の画面で設定が変わりました。保存済みの設定を読み込み、確認してください。","Your settings changed in another window. Load the saved settings and review them."),uncertain:t("保存を確認できませんでした。再送する前に、保存済みの設定を読み込んでください。","We couldn’t confirm the save. Load your saved settings before trying again.")};
 const displayItems=draft.watchItems.length?draft.watchItems:[{symbol:"",referencePrice:0}];
 // A price or symbol typed now is on today's basis (stock splits): the item's old price day is dropped and the save stamps today.
 function changeItem(i:number,patch:Partial<NotificationSettings["watchItems"][number]>){update({watchItems:displayItems.map((x,k)=>k===i?{symbol:x.symbol,referencePrice:x.referencePrice,...patch}:x)});}
 function conditionText(id:"q28"|"q29",extra:string[]){
  const question=questions.find(q=>q.id===id)!;
  const selected=plan?.answers?.[id];
  return [...questionCopy(question,locale).options.filter(o=>Array.isArray(selected)&&selected.some(value=>value===o.id)).map(o=>o.label),...extra].join(" / ")||t("未設定","Not set");
 }
 const lines=plan?.buyLines.map(l=>l.dropPct)??[];
 const validItems=draft.watchItems.filter(i=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(i.symbol)&&Number.isFinite(i.referencePrice)&&i.referencePrice>0&&i.referencePrice<=1000000);
 const watch=validItems.map(i=>({...i,lines,renotifyAfterRecovery:false,...(draft.surgeCapPct===null?{}:{surgeCapPct:draft.surgeCapPct})}));
 const events=judge(watch,watch.map(i=>({symbol:i.symbol,date:"2027-02-03",close:Math.max(0.01,Math.round(i.referencePrice*(100+change))/100),isFinal:true})),{}).events;
 // 「届く通知の例」: the phone notification (screens/01_push_*) and the 「今日のお知らせ」 page it opens. Nothing is sent.
 const sample=events.length?latestAlertFromDigest({date:"2027-02-03",items:events}):null;
 const usd=(v:number)=>new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:"USD"}).format(v);
 const timeButtons=<div className={styles.timeGrid}>{DELIVERY_HOURS.map(h=><button type="button" key={h} aria-pressed={draft.deliveryHourJst===h} onClick={()=>update({deliveryHourJst:h})}>{deliveryClock(h,locale)}</button>)}</div>;
 const lineColors=["#ecd48f","#eba85a","#e5744f","#cf4a52","#b03a62"];
 const picks=[t("計画どおり動いた","I followed my plan"),t("見送った","I held off"),t("まだ迷っている","I'm still unsure")];
 const rules=plan?ruleFacts(plan):null;
 const references=Object.fromEntries(validItems.map(i=>[i.symbol,i.referencePrice]));
 const alertExample=sample?<><PushSample body={resoluteAlertPushBody(events,locale)} locale={locale}/><p className={styles.muted}>{t("押すと「今日のお知らせ」が開きます","Tap it to open Today's alert")}</p><div className={styles.mailPreview}><LatestAlertContent locale={locale} state={{status:"ready",alert:sample}} context={{rules,references}}/></div></>:null;
 const status=<>
  {snapshot&&JSON.stringify(snapshot.settings)!==JSON.stringify(draft)?<p className={styles.status}>{t("変更はまだ保存していません。","You have unsaved changes.")}</p>:null}
  {message?<p role="status" className={message==="saved"?styles.status:styles.error}>{messages[message]}</p>:null}
  {locked&&message!=="preparing"?<button className={styles.secondary} disabled={busy||loading} onClick={()=>{setLoading(true);setAttempt(v=>v+1);}}>{t("保存済みの設定を読み込む（現在の入力を置き換えます）","Load saved settings (replaces your current changes)")}</button>:null}
 </>;
 const saveButton=(className:string)=><button type="button" className={className} onClick={()=>void save()} disabled={!snapshot||busy||loading||locked}>{busy?t("保存しています…","Saving…"):t("通知設定を保存する","Save notification settings")}</button>;
 const deliveryNote=<p className={styles.disclaimer}>{snapshot?.delivery?t("この画面の試算で通知は送信されません。","Using this screen will not send a notification."):t("通知の配信は準備中です。この画面の試算で通知は送信されません。","Notification delivery is not available yet. Using this screen will not send a notification.")}</p>;
 const planDialogElement=<>{/* 「計画を開く」 from the morning answer. */}
  <dialog ref={planDialog} className={styles.planDialog} onClose={()=>setPlanOpen(false)} onCancel={()=>setPlanOpen(false)} aria-labelledby="morning-plan-title">
   <h2 id="morning-plan-title">{t("あなたの計画", "Your plan")}</h2>
   {plan?<dl className={styles.ruleCards}>
    <div className={styles.ruleCard}><dt>{t("許容できる下落", "Loss limit")}</dt><dd>{plan.toleranceDrop===null?t("未設定","Not set"):new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:plan.currency}).format(plan.toleranceDrop/(plan.currency==="USD"?100:1))}</dd></div>
    <div className={styles.ruleCard}><dt>{t("1銘柄の上限", "Single-stock cap")}</dt><dd>{plan.perStockCapPct}%</dd></div>
    <div className={styles.ruleCard}><dt>{t("買い増しライン", "Purchase levels")}</dt><dd>{plan.buyLines.length?plan.buyLines.map(l=>`−${l.dropPct}% / ${new Intl.NumberFormat(en?"en-US":"ja-JP",{style:"currency",currency:plan.currency}).format(l.amount/(plan.currency==="USD"?100:1))}`).join(" / "):t("未設定","Not set")}</dd></div>
    <div className={styles.ruleCard}><dt>{t("買わない条件", "Conditions for holding off")}</dt><dd>{conditionText("q28",plan.noBuyConditions)}</dd></div>
    <div className={styles.ruleCard}><dt>{t("立ち止まる条件", "Conditions for pausing")}</dt><dd>{conditionText("q29",plan.haltConditions)}</dd></div>
   </dl>:<p>{t("保存済みの計画がありません", "No saved plan")}</p>}
   <button type="button" className={styles.primary} onClick={()=>setPlanOpen(false)}>{t("④ 翌朝のひとことに戻る", "Back to your morning note")}</button>
  </dialog></>;
 const morningPicker=<>
  <span className={styles.eyebrow}>GOOD MORNING</span>
  <p className={styles.morningQuestion}>{en?"Quick check-in on yesterday's alert.":<><span className={styles.phrase}>昨日のお知らせから</span><span className={styles.phrase}>一晩が経ちました</span></>}</p>
  <p className={styles.muted}>{en?"Pick whichever feels closest right now.":<><span className={styles.phrase}>今の気持ちに近いものを</span><span className={styles.phrase}>1つだけ選んでください</span></>}</p>
  {pick?<div className={styles.morningAnswer}><div className={`${styles.verdict} ${styles.verdictOk}`}><strong>{picks[(["done","skipped","unsure"] as const).indexOf(pick)]}</strong></div><p>{tips[locale][pick]}</p><button type="button" className={styles.primary} onClick={()=>setPlanOpen(true)}>{t("計画を開く","Open your plan")}</button><button className={styles.ghost} onClick={()=>setPick(null)}>{t("選び直す","Choose again")}</button></div>:<div className={styles.options}>{(["done","skipped","unsure"] as const).map((k,i)=><button key={k} className={styles.option} onClick={()=>setPick(k)}>{picks[i]}</button>)}</div>}
 </>;
 const morningOff=<p className={styles.muted}>{snapshot?t("通知を受け取らない設定です。","Notifications are turned off."):message==="preparing"?t("準備中です。準備ができたら、ここで受け取りの設定ができます。","Not ready yet. You’ll be able to turn this on here once it is."):t("保存済みの設定はまだ確認できていません。","We haven’t been able to check your saved settings yet.")}</p>;
 if(isMorning) {
  // ④ (owner, Nov 25). PC (01_翌朝のひとこと_温度計_PC 1): 「受け取り方」 on the left, the morning screen on the right, both
  // panels ending level; back to ③ on the left, save and on to ⑤ on the right. Phone (mobile 10): the morning screen first,
  // 「受け取り方」 below it, then save and the way on.
  const heading=desktop?<header className={pc.head}><div><p className={pc.eyebrow}><b>GOOD MORNING</b>{t("翌朝のひとこと","Morning note")}</p><h1 className={pc.title}>{t("翌朝のひとこと","Morning note")}</h1>
    <p className={pc.lead}>{t("お知らせの翌朝に、1通だけ届きます","One short notification the morning after an alert")}</p></div></header>
   :<header className={styles.toolHeading}><span className={styles.eyebrow}>GOOD MORNING</span><h1>{t("翌朝のひとこと","Morning note")}</h1><p className={styles.muted}>{t("お知らせの翌朝に、1通だけ届きます","One short notification the morning after an alert")}</p></header>;
  const goodMorning=<section className={`${styles.card} ${styles.hero} ${pc.panel} ${pc.morningPanel}`}>
   {draft.morningEnabled?morningPicker:<><span className={styles.eyebrow}>GOOD MORNING</span>{morningOff}</>}
   <p className={`${styles.disclaimer} ${pc.morningOnce}`}>{t("この通知は、昨日のお知らせについて1回だけ届きます。","We send this once per alert.")}</p>
  </section>;
  const howYouGetIt=<fieldset className={`${styles.settingsFields} ${pc.column}`} disabled={loading||busy||locked}>
   <section className={`${styles.card} ${pc.panel} ${pc.settings} ${pc.grow} ${pc.morningSettings}`}>
    <h2>{t("受け取り方","How you get it")}</h2>
    <label className={`${styles.switchRow} ${pc.lined}`}><span className={pc.switchText}><span>{en?"Get the morning note":<><span className={styles.phrase}>翌朝のひとことを</span><span className={styles.phrase}>受け取る</span></>}</span><small>{t("オンにするとお知らせと同じ時間に届きます","Turn it on to receive a note at the same time as your alerts.")}</small></span><input type="checkbox" role="switch" checked={draft.morningEnabled} onChange={e=>update({morningEnabled:e.target.checked})}/></label>
    <div className={`${pc.lined} ${pc.morningBlock}`}><h3 className={pc.blockTitle}>{t("届く時間","Delivery time")}<small>{deliveryZone(locale)}</small></h3>{timeButtons}</div>
    <div className={`${pc.lined} ${pc.morningBlock}`}><h3 className={pc.blockTitle}>{t("届け先","Where it goes")}</h3>
     {touch||!desktop?<div className={pc.thisDevice}><DeviceNotifications lang={locale} scope="resolute" initiallyOpen/><p className={styles.muted}>{mailText}</p></div>
      :<div className={pc.destinations}><div className={pc.destination}><b>{t("スマホ通知","Phone notifications")}</b><span>{t("スマホでこの画面を開くと、オンにできます","Open this page on your phone to turn them on")}</span></div>
       <div className={pc.destination}><b>{t("メール","Email")}</b><span>{mailText}</span></div></div>}
    </div>
    <div className={pc.morningBlock}><p className={pc.small}>{t("届く通知の例","Example notification")}</p>
     <div className={pc.push} role="img" aria-label={`RESOLUTE: ${resoluteMorningPushBody(locale)}`}><span className={pc.pushHead}><b>RESOLUTE</b><time>{deliveryClock(draft.deliveryHourJst,locale)}</time></span><strong>{resoluteMorningPushBody(locale)}</strong><small>{t("押すと、この画面で3つから選べます","Tap it to open this screen and pick one of the three")}</small></div>
    </div>
   </section>
  </fieldset>;
  return <div className={desktop?pc.content:styles.section}>
   {heading}
   {loading?<p role="status">{t("設定を読み込んでいます…","Loading your settings…")}</p>:null}
   {desktop?<div className={pc.morningPair}>{howYouGetIt}{goodMorning}</div>:<>{goodMorning}{howYouGetIt}</>}
   {status}
   {desktop?<FlowNavigation step={4} locale={locale} wide extra={saveButton(`${styles.secondary} ${pc.save}`)}/>:<>{saveButton(`${styles.secondary} ${pc.phoneSave}`)}<FlowNavigation step={4} locale={locale}/></>}
   <div className={pc.notes}>{deliveryNote}</div>
   {planDialogElement}
  </div>;
 }
 if(desktop&&!isMorning) {
  // PC (owner, Nov 25, 02_終値アラート_PC 1): settings on the left; the lines as a table and TRY IT on the right; both columns end level.
  const columns=[...lines.map((l,i)=>({key:`d${l}`,label:`−${l}%`,color:lineColors[Math.min(i,lineColors.length-1)],price:(r:number)=>r*(100-l)/100})),
   ...(draft.surgeCapPct!==null?[{key:"surge",label:`+${draft.surgeCapPct}%`,color:"#8fd6a8",price:(r:number)=>r*(100+(draft.surgeCapPct??0))/100}]:[])];
  const grid={gridTemplateColumns:`minmax(84px,1fr) repeat(${Math.max(1,columns.length)},minmax(0,1fr))`};
  return <div className={pc.content}>
   <header className={pc.head}><div><p className={pc.eyebrow}><b>CLOSING ALERT</b>{t("終値アラート","Closing-price alerts")}</p><h1 className={pc.title}>{t("終値アラート","Closing-price alerts")}</h1>
    <p className={pc.lead}>{t("ラインに届いた日に、スマホ通知でお知らせ","Get a phone notification on the day a line is hit")}</p></div></header>
   {loading?<p role="status">{t("設定を読み込んでいます…","Loading your settings…")}</p>:null}
   <div className={pc.columns}>
    <fieldset className={`${styles.settingsFields} ${pc.column}`} disabled={loading||busy||locked}>
     <section className={`${styles.card} ${pc.panel} ${pc.settings}`}><h2>{t("見る銘柄","Stocks to watch")}</h2><p className={styles.muted}>{t("カタカナでも会社名を検索できます", "You can search by company name too")}</p>
      <div className={pc.watchHead} aria-hidden="true"><span>{t("銘柄","Symbol")}</span><span>{t("基準","Reference")}</span><span /></div>
      {displayItems.map((item,i)=><div className={`${styles.stockRow} ${pc.watchRow}`} key={i}>
       <StockInput value={item.symbol} index={i} en={en} onChange={symbol=>changeItem(i,{symbol})}/>
       <label className={styles.referencePrice}><span>{t("基準","Reference")}</span><span className={styles.dollarInput}><i>$</i><NumberInput aria-label={t("基準価格","Reference price")+` ${i+1}`} decimal value={item.referencePrice||""} onValueChange={value=>changeItem(i,{referencePrice:value===""?0:Number(value)})}/></span></label>
       <button type="button" className={styles.removeButton} aria-label={t("銘柄を削除","Remove symbol")+` ${i+1}`} onClick={()=>update({watchItems:draft.watchItems.filter((_,k)=>k!==i)})}>×</button>
      </div>)}
      {draft.watchItems.length<5?<button type="button" className={styles.addButton} onClick={()=>update({watchItems:[...draft.watchItems,{symbol:"",referencePrice:0}]})}>{t("＋ 銘柄を追加","＋ Add a stock")}</button>:null}
     </section>
     <section className={`${styles.card} ${pc.panel} ${pc.settings}`}><h2>{t("知らせるライン","Alert levels")}</h2><p className={styles.muted}>{t("あなたのルールの買い増しラインです","These are the purchase levels from your rules")}</p>
      {lines.length?<div className={styles.lineChips}>{lines.map(l=><span key={l}>−{l}%</span>)}</div>:<p className={styles.muted}>{planState==="preparing"?t("保存したラインは、準備ができ次第、ここに自動で表示されます。","Your saved levels will appear here automatically once saving is switched on."):planState==="error"?t("保存済みのラインを読み込めませんでした。","Couldn’t load your saved levels."):t("買い増しラインはまだ設定されていません。","No purchase levels are set yet.")}</p>}
      <label className={`${styles.switchRow} ${pc.lined}`}><span>{t("上昇の目安も知らせる","Also alert me on a rise")}</span><input type="checkbox" role="switch" checked={draft.surgeCapPct!==null} onChange={e=>update({surgeCapPct:e.target.checked?50:null})}/></label>
      {draft.surgeCapPct!==null?<label className={`${styles.compactField} ${pc.lined}`}><span>{t("基準からの上昇率","Rise from reference price")}</span><span><NumberInput decimal value={draft.surgeCapPct} onValueChange={value=>update({surgeCapPct:Number(value)})}/> %</span></label>:null}
     </section>
     <section className={`${styles.card} ${pc.panel} ${pc.settings} ${pc.grow}`}><h2>{t("届く時間と届け先","Delivery time and where it goes")}</h2><p className={styles.muted}>{t("前の夜の終値をもとに、この時間にお知らせします(日本時間)","We check the U.S. closing prices and send alerts at this time (ET).")}</p>{timeButtons}
      <label className={`${styles.switchRow} ${pc.lined}`}><span>{t("終値アラートを受け取る","Receive closing-price alerts")}</span><input type="checkbox" role="switch" checked={draft.alertsEnabled} onChange={e=>update({alertsEnabled:e.target.checked})}/></label>
      {touch?<div className={pc.thisDevice}><DeviceNotifications lang={locale} scope="resolute" initiallyOpen/><p className={styles.muted}>{mailText}</p></div>
       :<div className={pc.destinations}><div className={pc.destination}><b>{t("スマホ通知","Phone notifications")}</b><span>{t("スマホでこの画面を開くと、オンにできます","Open this page on your phone to turn them on")}</span></div>
        <div className={pc.destination}><b>{t("メール","Email")}</b><span>{mailText}</span></div></div>}
     </section>
    </fieldset>
    <div className={pc.column}>
     <section className={`${styles.card} ${pc.panel} ${pc.grow}`}>
      <span className={styles.eyebrow}>LINES</span><h2 className={pc.panelTitle}>{t("あなたのライン","Your alert levels")}</h2>
      {validItems.length&&columns.length?<div className={pc.lineTable}>
       <div className={pc.lineHead} style={grid}><span>{t("銘柄","Symbol")}</span>{columns.map(c=><span key={c.key}><i style={{background:c.color}}>{c.label}</i></span>)}</div>
       {validItems.map(item=><div className={pc.lineRow} style={grid} key={item.symbol}><span><b>{item.symbol}</b><small>{t(`基準 ${usd(item.referencePrice).replace(/\.00$/,"")}`,`Ref. ${usd(item.referencePrice).replace(/\.00$/,"")}`)}</small></span>{columns.map(c=><strong key={c.key} style={{color:c.color}}>{usd(c.price(item.referencePrice))}</strong>)}</div>)}
      </div>:null}
      {!validItems.length?<p className={styles.muted}>{t("銘柄と基準価格を入れてください","Enter a symbol and reference price")}</p>:null}
     </section>
     <section className={`${styles.card} ${pc.panel} ${pc.tryIt}`}>
      <div className={pc.tryLeft}><span className={styles.eyebrow}>TRY IT</span><p className={styles.muted}>{t("もしも、ある日の終値が基準から","What if a closing price moved")}</p><p className={`${styles.percentNumber} ${pc.tryPercent}`}>{change>=0?"+":"−"}{Math.abs(change)}%</p><p className={styles.muted}>{t("だったら？","from your reference price?")}</p><input type="range" min="-50" max="100" value={change} aria-label={t("終値の変化","Closing-price change")} onChange={e=>setChange(Number(e.target.value))}/></div>
      <div className={pc.tryRight}><p className={pc.small}>{t("届く通知の例","Example notification")}</p>
       {sample?<div className={pc.push} role="img" aria-label={`RESOLUTE: ${resoluteAlertPushBody(events,locale)}`}><span className={pc.pushHead}><b>RESOLUTE</b><time>{deliveryClock(draft.deliveryHourJst,locale)}</time></span><strong>{resoluteAlertPushBody(events,locale)}</strong><small>{t("押すと「今日のお知らせ」が開きます","Tap it to open Today's alert")}</small></div>:<p className={styles.muted}>{t("この条件では通知に該当しません。","No alert would be sent in this example.")}</p>}
       <p className={pc.small}>{t("通知は、米国市場の終値が確定したあとに送ります。","Alerts are sent after US closing prices are final.")}</p></div>
     </section>
    </div>
   </div>
   {status}
   <FlowNavigation step={3} locale={locale} wide extra={saveButton(`${styles.secondary} ${pc.save}`)}/>
   <div className={pc.notes}><p className={styles.disclaimer}>{t("情報の提供であり、投資助言ではありません。","For information only. Not investment advice.")}</p>{deliveryNote}</div>
  </div>;
 }
 return <div className={styles.section}>
  <header className={styles.toolHeading}><h1>{isMorning?t("翌朝のひとこと","Morning note"):t("終値アラート","Closing-price alerts")}</h1><p className={styles.muted}>{isMorning?t("お知らせの翌朝に、1通だけ届きます","One short notification the morning after an alert"):t("ラインに届いた日に、スマホ通知でお知らせ","Get a phone notification on the day a line is hit")}</p></header>
  {/* Owner, Nov 17: ③④ arrive as phone notifications (the same part as Tech Phase's notification settings). */}
  <section className={styles.card}><DeviceNotifications lang={locale} scope="resolute" initiallyOpen/>{isMorning?null:<p className={styles.muted}>{mailText}</p>}</section>
  {loading?<p role="status">{t("設定を読み込んでいます…","Loading your settings…")}</p>:null}
  <fieldset className={styles.settingsFields} disabled={loading||busy||locked}>
   {isMorning?<section className={styles.card}>
    <label className={styles.switchRow}><span>{en?"Get the morning note":<><span className={styles.phrase}>翌朝のひとことを</span><span className={styles.phrase}>受け取る</span></>}</span><input type="checkbox" role="switch" checked={draft.morningEnabled} onChange={e=>update({morningEnabled:e.target.checked})}/></label>
    <p className={styles.muted}>{t("オンにするとお知らせと同じ時間に届きます","Turn it on to receive a note at the same time as your alerts.")}</p>
    <div className={styles.deliveryRow}><span>{deliveryClock(draft.deliveryHourJst,locale)} <small>{deliveryZone(locale)}</small></span><button type="button" className={styles.timeEdit} aria-expanded={timeOpen} aria-controls="morning-delivery-time" onClick={()=>setTimeOpen(v=>!v)}>{t("届く時間を変更する","Change delivery time")}</button></div>
    {timeOpen?<div id="morning-delivery-time">{timeButtons}</div>:null}
   </section>:<>
    <section className={styles.card}><h2>{t("見る銘柄（例：NVDA）","Stocks to watch (e.g. NVDA)")}</h2><p className={styles.muted}>{t("カタカナでも会社名を検索できます", "You can search by company name too")}</p>
     {displayItems.map((item,i)=><div className={styles.stockRow} key={i}>
      <StockInput value={item.symbol} index={i} en={en} onChange={symbol=>changeItem(i,{symbol})}/>
      <label className={styles.referencePrice}><span>{t("基準","Reference")}</span><span className={styles.dollarInput}><i>$</i><NumberInput aria-label={t("基準価格","Reference price")+` ${i+1}`} decimal value={item.referencePrice||""} onValueChange={value=>changeItem(i,{referencePrice:value===""?0:Number(value)})}/></span></label>
      <button type="button" className={styles.removeButton} aria-label={t("銘柄を削除","Remove symbol")+` ${i+1}`} onClick={()=>update({watchItems:draft.watchItems.filter((_,k)=>k!==i)})}>×</button>
     </div>)}
     {draft.watchItems.length<5?<button type="button" className={styles.addButton} onClick={()=>update({watchItems:[...draft.watchItems,{symbol:"",referencePrice:0}]})}>{t("＋ 銘柄を追加","＋ Add a stock")}</button>:null}
    </section>
    <section className={styles.card}><h2>{t("知らせるライン","Alert levels")}</h2><p className={styles.muted}>{t("あなたのルールの買い増しラインです","These are the purchase levels from your rules")}</p>
     {lines.length?<div className={styles.lineChips}>{lines.map(l=><span key={l}>−{l}%</span>)}</div>:<p className={styles.muted}>{planState==="preparing"?t("保存したラインは、準備ができ次第、ここに自動で表示されます。","Your saved levels will appear here automatically once saving is switched on."):planState==="error"?t("保存済みのラインを読み込めませんでした。","Couldn’t load your saved levels."):t("買い増しラインはまだ設定されていません。","No purchase levels are set yet.")}</p>}
     <label className={styles.switchRow}><span>{t("上昇の目安も知らせる","Also alert me on a rise")}</span><input type="checkbox" role="switch" checked={draft.surgeCapPct!==null} onChange={e=>update({surgeCapPct:e.target.checked?50:null})}/></label>
     {draft.surgeCapPct!==null?<label className={styles.compactField}><span>{t("基準からの上昇率","Rise from reference price")}</span><span><NumberInput decimal value={draft.surgeCapPct} onValueChange={value=>update({surgeCapPct:Number(value)})}/> %</span></label>:null}
    </section>
    <section className={styles.card}><h2>{t("届く時間","Delivery time")}</h2><p className={styles.muted}>{t("前の夜の終値をもとに、この時間にお知らせします(日本時間)","We check the U.S. closing prices and send alerts at this time (ET).")}</p>{timeButtons}
     <label className={styles.switchRow}><span>{t("終値アラートを受け取る","Receive closing-price alerts")}</span><input type="checkbox" role="switch" checked={draft.alertsEnabled} onChange={e=>update({alertsEnabled:e.target.checked})}/></label>
    </section>
   </>}
   {saveButton(styles.primary)}
  </fieldset>
  {status}
  {isMorning?<>
   {!draft.morningEnabled?<section className={`${styles.card} ${styles.hero}`}><p className={styles.muted}>{snapshot?t("通知を受け取らない設定です。","Notifications are turned off."):message==="preparing"?t("準備中です。準備ができたら、ここで受け取りの設定ができます。","Not ready yet. You’ll be able to turn this on here once it is."):t("保存済みの設定はまだ確認できていません。","We haven’t been able to check your saved settings yet.")}</p></section>:<section className={`${styles.card} ${styles.hero}`}>
    <span className={styles.eyebrow}>GOOD MORNING</span>
    <p className={styles.morningQuestion}>{en?"Quick check-in on yesterday's alert.":<><span className={styles.phrase}>昨日のお知らせから</span><span className={styles.phrase}>一晩が経ちました</span></>}</p>
    <p className={styles.muted}>{en?"Pick whichever feels closest right now.":<><span className={styles.phrase}>今の気持ちに近いものを</span><span className={styles.phrase}>1つだけ選んでください</span></>}</p>
    {pick?<div className={styles.morningAnswer}><div className={`${styles.verdict} ${styles.verdictOk}`}><strong>{picks[(["done","skipped","unsure"] as const).indexOf(pick)]}</strong></div><p>{tips[locale][pick]}</p><button type="button" className={styles.primary} onClick={()=>setPlanOpen(true)}>{t("計画を開く","Open your plan")}</button><button className={styles.ghost} onClick={()=>setPick(null)}>{t("選び直す","Choose again")}</button></div>:<><div className={styles.options}>{(["done","skipped","unsure"] as const).map((k,i)=><button key={k} className={styles.option} onClick={()=>setPick(k)}>{picks[i]}</button>)}</div><p className={styles.disclaimer}>{t("この通知は、昨日のお知らせについて1回だけ届きます。","We send this once per alert.")}</p></>}
   </section>}
   {draft.morningEnabled?<details className={`${styles.card} ${styles.disclosure}`}><summary>{t("届く通知の例","Example notification")}</summary><PushSample body={resoluteMorningPushBody(locale)} locale={locale}/><p className={styles.muted}>{t("押すと、この画面で3つから選べます","Tap it to open this screen and pick one of the three")}</p></details>:null}
  </>:<section className={`${styles.card} ${styles.hero}`}>
    <span className={styles.eyebrow}>LINES</span><h2 className={styles.linesTitle}>{t("あなたのライン","Your alert levels")}</h2>
    <div className={styles.alertLines}>{validItems.map(item=><div className={styles.stockLines} key={item.symbol}><strong>{item.symbol}</strong>{lines.map((l,i)=><div className={styles.priceLine} key={l} style={{"--line-color":lineColors[Math.min(i,lineColors.length-1)]} as CSSProperties}><span>−{l}%</span><b>{usd(item.referencePrice*(100-l)/100)}</b></div>)}{draft.surgeCapPct!==null?<div className={styles.priceLine} style={{"--line-color":"#8fd6a8"} as CSSProperties}><span>+{draft.surgeCapPct}%</span><b>{usd(item.referencePrice*(100+draft.surgeCapPct)/100)}</b></div>:null}</div>)}</div>
    {!validItems.length?<p className={styles.muted}>{t("銘柄と基準価格を入れてください","Enter a symbol and reference price")}</p>:null}
    <hr className={styles.divider}/><span className={styles.eyebrow}>TRY IT</span><p className={styles.muted}>{t("もしも、ある日の終値が基準から","What if a closing price moved")}</p><p className={styles.percentNumber}>{change>=0?"+":"−"}{Math.abs(change)}%</p><p className={styles.muted}>{t("だったら？","from your reference price?")}</p><input type="range" min="-50" max="100" value={change} aria-label={t("終値の変化","Closing-price change")} onChange={e=>setChange(Number(e.target.value))}/>
    <details className={styles.mailDetails}><summary>{t("届く通知の例を見る","See an example notification")}</summary>{alertExample??<p className={styles.muted}>{t("この条件では通知に該当しません。","No alert would be sent in this example.")}</p>}</details>
   </section>}
  {!isMorning?<p className={styles.disclaimer}>{t("通知は、米国市場の終値が確定したあとに送ります。","Alerts are sent after US closing prices are final.")}<br/>{t("情報の提供であり、投資助言ではありません。","For information only. Not investment advice.")}</p>:null}
  {/* Shown only until resolute-api reports that delivery is switched on (lib/resolute/notification-delivery-state.ts). */}
  {deliveryNote}
  {planDialogElement}
  <FlowNavigation step={isMorning?4:3} locale={locale}/>
 </div>;
}
