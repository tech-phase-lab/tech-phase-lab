"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import ToolShell from "./tool-shell";
import styles from "./diagnosis.module.css";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import type { PlanInput } from "@/lib/resolute/plan-data";
import { requestPlan,PlanClientError } from "@/lib/resolute/plan-client";
import { DELIVERY_HOURS,defaultNotificationSettings,parseNotificationSettings,type NotificationSettings,type NotificationSnapshot } from "@/lib/resolute/notification-settings";
import { requestNotificationSettings,NotificationClientError } from "@/lib/resolute/notification-client";
import { judge } from "@/lib/resolute/alert-judge";
import { renderAlertMail,renderNextMorningMail } from "@/lib/resolute/mail-templates";

const tips={
 ja:{done:"計画どおりに動けた夜は、そのまま記録しておく価値があります。ルールに書いたことと実際にやったことが同じだったか、1行だけ見直してみてください。次の下落でも、迷いにくくなります。",skipped:"見送ることも、ルールの中の選択肢のひとつです。見送った理由が「買わない条件」に入っているか確かめてみてください。入っていなければ、足しておくと次に迷いません。",unsure:"迷っているのは、ルールとその夜の気持ちがずれているサインかもしれません。急いで決めなくて大丈夫です。計画を開いて、ラインと買い増しの額をもう一度読んでみてください。"},
 en:{done:"A night when you stuck to the plan is worth noting. Take a minute to check that what you did matched the rules you wrote. It makes the next drop easier to face.",skipped:"Skipping is one of the choices in your rules. Check whether your reason is already in your hold-off conditions. If it isn't, add it so you won't wonder next time.",unsure:"Feeling unsure can mean your rules and your mood have drifted apart. There's no rush. Open your plan and reread your lines and amounts."}
};
export default function NotificationScreen({identityReady=true,mode}:{identityReady?:boolean;mode:"alerts"|"morning"}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><Notifications locale={locale} deny={deny} mode={mode}/>}</ToolShell>;
}
function Notifications({locale,deny,mode}:{locale:DiagnosisLocale;deny:()=>void;mode:"alerts"|"morning"}) {
 const [snapshot,setSnapshot]=useState<NotificationSnapshot|null>(null),[draft,setDraft]=useState<NotificationSettings>(defaultNotificationSettings);
 const [plan,setPlan]=useState<PlanInput|null>(null),[planState,setPlanState]=useState("loading"),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[attempt,setAttempt]=useState(0);
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
 },[attempt]);
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
 return <div className={styles.section}>
  <header><span className={styles.eyebrow}>{isMorning?"04 / NEXT MORNING":"03 / CLOSING-PRICE ALERTS"}</span><h1>{isMorning?t("翌朝のひとこと","A next-morning check-in"):t("終値アラート","Closing-price alerts")}</h1><p className={styles.muted}>{isMorning?t("お知らせの翌朝に、1通だけ届きます。","One check-in the morning after an alert."):t("ラインに届いた日に、メールでお知らせ。","An email when the closing price reaches a level in your plan.")}</p></header>
  <p className={styles.status}>{t("メール配信は準備中です。","Email delivery is being prepared.")}</p>
  {snapshot&&JSON.stringify(snapshot.settings)!==JSON.stringify(draft)?<p className={styles.status}>{t("変更はまだ保存していません。","You have unsaved changes.")}</p>:null}
  {loading?<p role="status">{t("設定を読み込んでいます…","Loading your settings…")}</p>:null}
  <fieldset className={styles.settingsFields} disabled={loading||busy||locked}>
   {isMorning?<section className={styles.card}><label className={styles.switchRow}><span>{t("翌朝のひとことを受け取る","Receive a next-morning check-in")}</span><input type="checkbox" role="switch" checked={draft.morningEnabled} onChange={e=>update({morningEnabled:e.target.checked})}/></label><p className={styles.muted}>{t("初めはオフです。オンにすると、お知らせの翌朝、アラートと同じ時間に届きます。","Off by default. Turn it on for one follow-up the next morning, at the same time as your alerts.")}</p><p>{draft.deliveryHourJst}:00 {t("日本時間","Japan time (JST)")}</p><Link href="/resolute/alerts" prefetch={false}>{t("届く時間を変更する","Change delivery time")}</Link></section>:<>
    <section className={styles.card}><h2>{t("見る銘柄","Stocks to watch")}</h2><p className={styles.muted}>{t("基準価格は米ドルです。銘柄と基準価格を入力してください。","Reference prices are in US dollars. Enter a symbol and its reference price.")}</p>
     {draft.watchItems.map((item,i)=><div className={styles.watchRow} key={i}><label className={styles.field}>{t("銘柄","Symbol")} {i+1}<input type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={15} value={item.symbol} onChange={e=>update({watchItems:draft.watchItems.map((x,k)=>k===i?{...x,symbol:e.target.value.toUpperCase().trim()}:x)})}/></label><label className={styles.field}>{t("基準価格","Reference price")} (USD)<input type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" value={item.referencePrice||""} onChange={e=>update({watchItems:draft.watchItems.map((x,k)=>k===i?{...x,referencePrice:e.target.value===""?0:Number(e.target.value)}:x)})}/></label><button className={styles.removeButton} aria-label={t("銘柄を削除","Remove symbol")+` ${i+1}`} onClick={()=>update({watchItems:draft.watchItems.filter((_,k)=>k!==i)})}>×</button></div>)}
     {draft.watchItems.length<5?<button className={styles.secondary} onClick={()=>update({watchItems:[...draft.watchItems,{symbol:"",referencePrice:0}]})}>{t("＋ 銘柄を追加","＋ Add a stock")}</button>:null}
    </section>
    <section className={styles.card}><h2>{t("知らせるライン","Alert levels")}</h2><p className={styles.muted}>{t("保存済みのルールの買い増しラインです。","These are the purchase levels in your saved plan.")}</p>
     {lines.length?<div className={styles.chips}>{lines.map(l=><span key={l}>−{l}%</span>)}</div>:<p className={styles.muted}>{planState==="error"?t("保存済みのラインを読み込めませんでした。","Couldn’t load your saved levels."):t("買い増しラインはまだ設定されていません。","No purchase levels are set yet.")}</p>}
     <label className={styles.switchRow}><span>{t("上昇の目安も知らせる","Include an upside marker")}</span><input type="checkbox" role="switch" checked={draft.surgeCapPct!==null} onChange={e=>update({surgeCapPct:e.target.checked?50:null})}/></label>
     {draft.surgeCapPct!==null?<label className={styles.field}>{t("基準からの上昇率","Rise from the reference price")} (%)<input type="number" min="0.1" max="1000" step="0.1" value={draft.surgeCapPct} onChange={e=>update({surgeCapPct:Number(e.target.value)})}/></label>:null}
    </section>
    <section className={styles.card}><h2>{t("届く時間","Delivery time")}</h2><p className={styles.muted}>{t("米国市場の確定した終値をもとに、この時間にお知らせします（日本時間）。","We check the final US closing prices and send alerts at your chosen time in Japan (JST).")}</p><div className={styles.timeGrid}>{DELIVERY_HOURS.map(h=><button key={h} aria-pressed={draft.deliveryHourJst===h} onClick={()=>update({deliveryHourJst:h})}>{h}:00</button>)}</div>
     <label className={styles.switchRow}><span>{t("終値アラートを受け取る","Receive closing-price alerts")}</span><input type="checkbox" role="switch" checked={draft.alertsEnabled} onChange={e=>update({alertsEnabled:e.target.checked})}/></label>
    </section>
   </>}
   <button className={styles.primary} onClick={()=>void save()} disabled={!snapshot||busy||loading||locked}>{busy?t("保存しています…","Saving…"):t("通知設定を保存する","Save notification settings")}</button>
  </fieldset>
  {message?<p role="status" className={message==="saved"?styles.status:styles.error}>{messages[message]}</p>:null}
  {locked?<button className={styles.secondary} disabled={busy||loading} onClick={()=>{setLoading(true);setAttempt(v=>v+1);}}>{t("保存済みの設定を読み込む（現在の入力を置き換えます）","Load saved settings (replaces your current changes)")}</button>:null}
  {isMorning?<>
   {!draft.morningEnabled?<section className={`${styles.card} ${styles.hero}`}><p>{snapshot?t("受け取らない設定です。変更した場合は保存してください。","Set to off. Save any changes to apply them."):t("保存済みの設定はまだ確認できていません。","Your saved settings have not been confirmed.")}</p></section>:<section className={`${styles.card} ${styles.hero}`}><span className={styles.eyebrow}>GOOD MORNING</span><p className={styles.muted}>{t("届く内容の例です。回答は保存しません。","Preview only. Your selection is not saved.")}</p><h2>{t("いまの気持ちに近いものを、1つだけ選んでください。","Pick whichever feels closest right now.")}</h2>
    {pick?<><p className={styles.verdict}>{t("どれを選んでも、正解・不正解はありません。","There are no right or wrong answers.")}</p><p>{tips[locale][pick]}</p><Link href="/resolute" className={styles.primary} prefetch={false}>{t("計画を開く","Open your plan")}</Link><button className={styles.secondary} onClick={()=>setPick(null)}>{t("選び直す","Choose again")}</button></>:<div className={styles.options}>{(["done","skipped","unsure"] as const).map((k,i)=><button key={k} className={styles.option} onClick={()=>setPick(k)}>{[t("計画どおり動いた","I followed my plan"),t("見送った","I skipped it"),t("まだ迷っている","I'm still not sure")][i]}</button>)}</div>}
   </section>}
   {draft.morningEnabled?<details className={styles.card}><summary>{t("メール文面の下書き","Draft email preview")}</summary><h2>{morningMail.subject}</h2><pre className={styles.mailText}>{morningMail.text}</pre></details>:null}
  </>:<section className={`${styles.card} ${styles.hero}`}><span className={styles.eyebrow}>LINES</span><h2>{t("あなたのライン","Your price levels")}</h2>
    {validItems.map(item=><div key={item.symbol}><strong>{item.symbol}</strong>{lines.map(l=><div className={styles.valueRow} key={l} data-reached={-change>=l}><span>−{l}%</span><strong>{usd(item.referencePrice*(100-l)/100)}</strong></div>)}{draft.surgeCapPct!==null?<div className={styles.valueRow}><span>+{draft.surgeCapPct}%</span><strong>{usd(item.referencePrice*(100+draft.surgeCapPct)/100)}</strong></div>:null}</div>)}
    {!validItems.length?<p>{t("銘柄と基準価格を入れてください。","Enter a symbol and reference price.")}</p>:null}
    <hr className={styles.divider}/><span className={styles.eyebrow}>TRY IT</span><p>{t("もしも、ある日の終値が基準から","What if a closing price moved")}</p><p className={styles.bigNumber}>{change>=0?"+":"−"}{Math.abs(change)}%</p><p>{t("だったら？","from your reference?")}</p><input type="range" min="-50" max="100" value={change} aria-label={t("終値の変化","Closing-price change")} onChange={e=>setChange(Number(e.target.value))}/>
    <p className={styles.muted}>{t("これは試算です。実際の株価ではなく、メールも送信しません。","This is a simulation, not a live price. It does not send an email.")}</p>
    <details className={styles.rulesDetails}><summary>{t("届くメールの例を見る","Preview an example email")}</summary>{mail?<><h2>{mail.subject}</h2><pre className={styles.mailText}>{mail.text}</pre></>:<p>{t("この条件では通知に該当しません。","This scenario would not trigger an alert.")}</p>}</details>
   </section>}
  <p className={styles.muted}>{t("通知には有効なRESOLUTEの利用権と通知利用権が必要です。終値が未確定の銘柄は、次の通知時刻に再確認します。情報の提供であり、投資助言ではありません。","Notifications require an active RESOLUTE purchase and notification entitlement. Prices that are not final are checked again at your next scheduled time. This is information, not investment advice.")}</p>
 </div>;
}
