"use client";
import { useEffect, useRef, useState } from "react";
import Rulebook from "./book";
import ToolShell from "../tool-shell";
import NumberInput from "../number-input";
import { ReviewLink as Link, usePlanClient, useNotificationClient } from "../review-context";
import { PlanClientError } from "@/lib/resolute/plan-client";
import type { PlanSnapshot } from "@/lib/resolute/plan-data";
import type { NotificationSnapshot } from "@/lib/resolute/notification-settings";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import { notebookResult,notebookEdits,adjustNotebook,notebookDocument,type NotebookEdits } from "@/lib/resolute/notebook";
import styles from "../diagnosis.module.css";
export default function NotebookScreen({identityReady=true}:{identityReady?:boolean}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><Notebook locale={locale} deny={deny}/>}</ToolShell>;
}
function Notebook({locale,deny}:{locale:DiagnosisLocale;deny:()=>void}) {
 const requestPlan=usePlanClient(), requestNotifications=useNotificationClient(),en=locale==="en";
 const [snapshot,setSnapshot]=useState<PlanSnapshot|null>(null),[notifications,setNotifications]=useState<NotificationSnapshot|null>(null);
 const [edits,setEdits]=useState<NotebookEdits|null>(null),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState("");
 const [attempt,setAttempt]=useState(0), pending=useRef<AbortController|null>(null),mutex=useRef(false),denyRef=useRef(deny),editor=useRef<HTMLElement>(null);
 const notice:Record<string,string>={load:en?"We couldn’t load your saved rules. Please try again.":"保存済みのルールを読み込めませんでした。再確認してください。",invalid:en?"Check the numbers and text lengths. Use up to 10 conditions, 100 characters each.":"数字と文字数を確認してください。条件は1行100文字までで10行以内です。",saved:en?"Your rules are saved.":"マイルールを保存しました",conflict:en?"Your plan changed in another window. Your edits are still here. Load the saved version before editing again.":"別の画面で更新されています。入力は残しています。保存済みの内容を読み込んでから見直してください。",uncertain:en?"We couldn’t confirm your rules were saved. Load the saved version before trying again.":"保存を確認できませんでした。再送する前に保存済みの内容を読み込んでください。"};
 const editing=edits!==null;
 useEffect(()=>{if(editing){editor.current?.scrollIntoView({block:"start",behavior:"instant"});editor.current?.focus({preventScroll:true});}},[editing]);
 useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;
  void requestPlan(undefined,controller.signal).then(p=>{if(!controller.signal.aborted){setSnapshot(p);setLocked(false);setMessage("");}},e=>{
   if(controller.signal.aborted)return;
   if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind))denyRef.current();
   else setMessage("load");
  });
  void requestNotifications(undefined,controller.signal).then(n=>{if(!controller.signal.aborted)setNotifications(n);},()=>{});
  return()=>pending.current?.abort();
 // Language changes only presentation, never reload or replace an edit.
 },[requestPlan,requestNotifications,attempt]);
 async function save(){
  if(!snapshot?.plan||!edits||locked||mutex.current)return;
  let plan;try{plan=adjustNotebook(snapshot.plan,edits);}catch{setMessage("invalid");return;}
  mutex.current=true;setBusy(true);const controller=new AbortController();pending.current=controller;
  try{const next=await requestPlan({plan,baseRevision:snapshot.revision},controller.signal);if(!controller.signal.aborted){setSnapshot(next);setEdits(null);setMessage("saved");}}
  catch(e){if(controller.signal.aborted)return;if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind)){deny();return;}setLocked(true);setMessage(e instanceof PlanClientError&&e.kind==="conflict"?"conflict":"uncertain");}
  finally{mutex.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 function download(){if(!snapshot?.plan)return;const blob=new Blob([notebookDocument(snapshot.plan,locale)],{type:"text/html;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`RESOLUTE-my-rules-${snapshot.plan.updatedAt.slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(!snapshot)return <section className={styles.card}><h1>{en?"My rulebook":"マイルール"}</h1><p role="status">{notice[message]||(en?"Opening your saved rules…":"保存済みのルールを開いています…")}</p>{message?<button className={styles.secondary} onClick={()=>setAttempt(n=>n+1)}>{en?"Try again":"再確認"}</button>:null}</section>;
 if(!snapshot.plan)return <section className={styles.card}><h1>{en?"Your rulebook starts here":"自分だけの一冊をつくる"}</h1><p>{en?"Complete the quiz and save your rules first.":"①の診断でルールを保存するとここにまとまります"}</p><Link href="/resolute/diagnosis" className={styles.primary}>{en?"Start the quiz":"① 診断を開く"}</Link></section>;
 const plan=snapshot.plan,result=notebookResult(plan,locale),settings=notifications?.settings;
 let preview:ReturnType<typeof notebookResult>|null=null;
 if(edits)try{preview=notebookResult(adjustNotebook(plan,edits),locale);}catch{/* Invalid edits remain editable. */}
 return <div className={styles.section}>
  <div className={styles.notebookIntro}><h1>{en?"A book to return to":"迷った日に開く一冊"}</h1></div>
  <Rulebook plan={plan} locale={locale}/>
  <div className={styles.bookUtility}><button className={styles.secondary} disabled={busy||!!edits} onClick={()=>{setEdits(notebookEdits(plan));setMessage("");}}>{en?"Review my rules":"ルールを見直す"}</button></div>
  {edits?<section className={`${styles.card} ${styles.bookEditor}`} ref={editor} tabIndex={-1} aria-label={en?"Adjust my rules":"マイルールの最終調整"}><h2>{en?"Fine-tune my rules":"マイルールを整える"}</h2><p className={styles.muted}>{en?"Purchase levels, amounts and notification settings stay as saved. Review the updated figures below before saving.":"買い増しラインと金額 通知設定はそのまま残します。保存前に変更後の数字を確認してください。"}</p>
   {([['reserveMonths',en?'Cash cushion (months)':'手をつけずに置く月数'],['perStockCapPct',en?'Limit per stock (%)':'1銘柄の上限（%）']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<NumberInput decimal value={edits[key]} onValueChange={value=>setEdits({...edits,[key]:value})}/></label>)}
   <label className={styles.field}>{en?"My stop-loss level (%) · optional":"自分で決める損切りライン（%）任意"}<NumberInput decimal value={edits.stopLossPct??""} onValueChange={value=>setEdits({...edits,stopLossPct:value})}/><span className={styles.muted}>{en?"0.1–99.9%. Measured against the investment base in your plan, not an individual stock’s purchase price. Leave blank if undecided. No automatic selling.":"0.1〜99.9% 診断に入力した投資額全体に対する下落率です。銘柄ごとの買値からの下落率ではありません。未定なら空欄にできます。自動売却は行いません。"}</span></label>
   {([['noBuyConditions',en?'My conditions for holding off':'買わないとき 自分で決めた条件'],['haltConditions',en?'My conditions for pausing':'手を止めるとき 自分で決めた条件']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<textarea value={edits[key]} onChange={e=>setEdits({...edits,[key]:e.target.value})}/></label>)}
   <p className={styles.muted}>{en?"One condition per line. Don’t include anyone’s personal details. The conditions you chose in the quiz will stay.":"1行に1件 個人が特定できる情報は書かないでください。診断で選んだ条件はそのまま残ります。"}</p>
   {preview?<dl className={styles.ruleCards}>{preview.rows.slice(0,3).map(row=><div className={styles.ruleCard} key={row.item}><dt>{row.item}</dt><dd>{row.rule}</dd></div>)}</dl>:null}
   <button className={styles.primary} disabled={busy||locked||!preview} onClick={()=>void save()}>{busy?(en?"Saving…":"保存しています…"):(en?"Save my rules":"マイルールを保存する")}</button><button className={styles.ghost} disabled={busy} onClick={()=>setEdits(null)}>{en?"Cancel":"変更をやめる"}</button>
  </section>:null}
  {message?<p className={styles.status} role="status">{notice[message]}</p>:null}
  {locked?<button className={styles.secondary} onClick={()=>{if(window.confirm(en?"Replace these edits with the saved version?":"入力を保存済みの内容に置き換えますか？")){setEdits(null);setAttempt(n=>n+1);}}}>{en?"Load saved version":"保存済みの内容を読み込む"}</button>:null}
  <details className={styles.bookSettings}><summary>{en?"My notifications":"いつものお知らせ"}</summary><div className={styles.bookNotifications}>
   {settings?<><div className={styles.bookSectionHead}><p>{settings.alertsEnabled?(en?"Closing-price alerts on":"終値アラート オン"):(en?"Closing-price alerts off":"終値アラート オフ")} · {settings.deliveryHourJst}:00 {en?"JST":"日本時間"}</p><Link href="/resolute/alerts" className={styles.secondary}>{en?"Change":"変更"}</Link></div><div className={styles.bookSectionHead}><p>{settings.morningEnabled?(en?"Morning note on":"翌朝のひとこと オン"):(en?"Morning note off":"翌朝のひとこと オフ")}</p><Link href="/resolute/morning" className={styles.secondary}>{en?"Change":"変更"}</Link></div></>:<p>{en?"We couldn’t load your notification settings.":"通知設定を確認できませんでした"}</p>}
  </div></details>
  <section className={styles.bookActions}><button className={styles.primary} disabled={!!edits||busy} onClick={download}>{en?"Save this book":"この一冊を保存する"}</button><p>{en?"Read it anytime, even offline.":"通信なしで読み返せます。"}<br/>{en?"Keep it somewhere only you can access.":"自分だけが開ける場所に保管してください。"}</p></section>
  <p className={styles.disclaimer}>{result.disclaimer}</p>
 </div>;
}
