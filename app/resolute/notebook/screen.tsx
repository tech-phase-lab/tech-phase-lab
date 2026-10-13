"use client";
import { useEffect, useRef, useState } from "react";
import ToolShell from "../tool-shell";
import NumberInput from "../number-input";
import { ReviewLink as Link, usePlanClient, useNotificationClient, useReview } from "../review-context";
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
 const requestPlan=usePlanClient(), requestNotifications=useNotificationClient(),review=useReview(),en=locale==="en";
 const [snapshot,setSnapshot]=useState<PlanSnapshot|null>(null),[notifications,setNotifications]=useState<NotificationSnapshot|null>(null);
 const [edits,setEdits]=useState<NotebookEdits|null>(null),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState("");
 const [attempt,setAttempt]=useState(0), pending=useRef<AbortController|null>(null),mutex=useRef(false),denyRef=useRef(deny),editor=useRef<HTMLElement>(null);
 const editing=edits!==null;
 useEffect(()=>{if(editing){editor.current?.scrollIntoView({block:"start",behavior:"instant"});editor.current?.focus({preventScroll:true});}},[editing]);
 useEffect(()=>{denyRef.current=deny;},[deny]);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;
  void requestPlan(undefined,controller.signal).then(p=>{if(!controller.signal.aborted){setSnapshot(p);setLocked(false);setMessage("");}},e=>{
   if(controller.signal.aborted)return;
   if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind))denyRef.current();
   else setMessage(en?"Your saved rules could not be loaded. Try again.":"保存済みのルールを読み込めませんでした。再確認してください。");
  });
  void requestNotifications(undefined,controller.signal).then(n=>{if(!controller.signal.aborted)setNotifications(n);},()=>{});
  return()=>pending.current?.abort();
 // Language changes only presentation, never reload or replace an edit.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[requestPlan,requestNotifications,attempt]);
 async function save(){
  if(!snapshot?.plan||!edits||locked||mutex.current)return;
  let plan;try{plan=adjustNotebook(snapshot.plan,edits);}catch{setMessage(en?"Check the numbers and text lengths. Use up to 10 conditions, 100 characters each.":"数字と文字数を確認してください。条件は1行100文字までで10行以内です。");return;}
  mutex.current=true;setBusy(true);const controller=new AbortController();pending.current=controller;
  try{const next=await requestPlan({plan,baseRevision:snapshot.revision},controller.signal);if(!controller.signal.aborted){setSnapshot(next);setEdits(null);setMessage(en?"Your rules are saved.":"マイルールを保存しました");}}
  catch(e){if(controller.signal.aborted)return;if(e instanceof PlanClientError&&["signed-out","denied"].includes(e.kind)){deny();return;}setLocked(true);setMessage(e instanceof PlanClientError&&e.kind==="conflict"?(en?"Your plan changed in another window. Your edits are still here. Load the saved version before editing again.":"別の画面で更新されています。入力は残しています。保存済みの内容を読み込んでから見直してください。"):(en?"The save could not be confirmed. Load the saved version before trying again.":"保存を確認できませんでした。再送する前に保存済みの内容を読み込んでください。"));}
  finally{mutex.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 function download(){if(!snapshot?.plan)return;const blob=new Blob([notebookDocument(snapshot.plan,locale)],{type:"text/html;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`RESOLUTE-my-rules-${snapshot.plan.updatedAt.slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(!snapshot)return <section className={styles.card}><h1>{en?"My rulebook":"マイルール"}</h1><p role="status">{message||(en?"Opening your saved rules…":"保存済みのルールを開いています…")}</p>{message?<button className={styles.secondary} onClick={()=>setAttempt(n=>n+1)}>{en?"Try again":"再確認"}</button>:null}</section>;
 if(!snapshot.plan)return <section className={styles.card}><h1>{en?"Your rulebook starts here":"自分だけの一冊をつくる"}</h1><p>{en?"Complete the quiz and save your rules first.":"①の診断でルールを保存するとここにまとまります"}</p><Link href="/resolute" className={styles.primary}>{en?"Start the quiz":"① 診断を開く"}</Link></section>;
 const plan=snapshot.plan,result=notebookResult(plan,locale),settings=notifications?.settings;
 let preview:ReturnType<typeof notebookResult>|null=null;
 if(edits)try{preview=notebookResult(adjustNotebook(plan,edits),locale);}catch{/* Invalid edits remain editable. */}
 return <div className={styles.section}>
  <div className={styles.notebookIntro}><span className={styles.eyebrow}>YOUR PERSONAL RULEBOOK</span><h1>{en?"Make these rules your own":"マイルールを仕上げる"}</h1><p>{en?"A place to return to when the market moves.":"相場が動いた日に立ち戻る 自分だけの一冊"}</p></div>
  <article className={styles.notebook} aria-label={en?"My investing rulebook":"私の投資ルール"}>
   <header className={styles.bookCover}><span>RESOLUTE</span><div className={styles.bookOrnament} aria-hidden="true">◇</div><h2>{en?<>My investing<br/>rulebook</>:<>私の<br/>投資ルール</>}</h2><p>{result.typeName}</p><small>{plan.currency} · {en?"Saved":"保存日"} {new Date(plan.updatedAt).toLocaleDateString(en?"en-US":"ja-JP",{timeZone:"Asia/Tokyo"})}</small></header>
   <div className={styles.bookPages}><div className={styles.bookSectionHead}><span>{en?"THE RULES I RETURN TO":"私が立ち戻るルール"}</span><button className={styles.bookEdit} disabled={busy} onClick={()=>{setEdits(notebookEdits(plan));setMessage("");}}>{en?"Adjust":"最終調整"}</button></div>
   <dl className={styles.bookRules}>{result.rows.map((row,index)=><div key={row.item}><dt><span>{String(index+1).padStart(2,"0")}</span>{row.item}</dt><dd>{row.rule}</dd></div>)}</dl>
   <section className={styles.bookNotifications}><div className={styles.bookSectionHead}><h3>{en?"My alerts":"いつものお知らせ"}</h3><Link href="/resolute/alerts" className={styles.bookEdit}>{en?"Change":"変更"}</Link></div>
    {settings?<><p>{settings.alertsEnabled?(en?"Closing-price alerts on":"終値アラート オン"):(en?"Closing-price alerts off":"終値アラート オフ")}<br/>{settings.deliveryHourJst}:00 {en?"Japan time":"日本時間"}</p><p>{settings.watchItems.map(x=>x.symbol).join(" · ")|| (en?"No stocks saved":"保存済みの銘柄はありません")}</p><div className={styles.bookSectionHead}><p>{settings.morningEnabled?(en?"Morning note on":"翌朝のひとこと オン"):(en?"Morning note off":"翌朝のひとこと オフ")}</p><Link href="/resolute/morning" className={styles.bookEdit}>{en?"Change":"変更"}</Link></div></>:<p>{en?"Notification settings could not be loaded.":"通知設定を確認できませんでした"}</p>}
    <small>{en?"Editing this rulebook does not change your notification settings.":"ノートの調整で通知設定が変わることはありません"}</small>
   </section><p className={styles.bookClosing}>{en?<>With rules of your own,<br/>crashes and rallies lose their grip.</>:<>マイルールを定めれば<br/>暴落も上昇も怖くない</>}</p></div>
  </article>
  {edits?<section className={`${styles.card} ${styles.bookEditor}`} ref={editor} tabIndex={-1} aria-label={en?"Adjust my rules":"マイルールの最終調整"}><h2>{en?"The finishing touches":"マイルールの最終調整"}</h2><p className={styles.muted}>{en?"Purchase levels, amounts and notification settings stay as saved. Review the updated figures below before saving.":"買い増しラインと金額 通知設定はそのまま残します。保存前に変更後の数字を確認してください。"}</p>
   {([['reserveMonths',en?'Cash cushion (months)':'手をつけずに置く月数'],['perStockCapPct',en?'Limit per stock (%)':'1銘柄の上限（%）']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<NumberInput decimal value={edits[key]} onValueChange={value=>setEdits({...edits,[key]:value})}/></label>)}
   {([['noBuyConditions',en?'My conditions for holding off':'買わないとき 自分で決めた条件'],['haltConditions',en?'My conditions for pausing':'手を止めるとき 自分で決めた条件']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<textarea value={edits[key]} onChange={e=>setEdits({...edits,[key]:e.target.value})}/></label>)}
   <p className={styles.muted}>{en?"One condition per line. Do not include information that could identify anyone. Conditions selected in the quiz are kept.":"1行に1件 個人が特定できる情報は書かないでください。診断で選んだ条件はそのまま残ります。"}</p>
   {preview?<dl className={styles.ruleCards}>{preview.rows.slice(0,3).map(row=><div className={styles.ruleCard} key={row.item}><dt>{row.item}</dt><dd>{row.rule}</dd></div>)}</dl>:null}
   <button className={styles.primary} disabled={busy||locked||!preview} onClick={()=>void save()}>{busy?(en?"Saving…":"保存しています…"):(en?"Save my rules":"マイルールを保存する")}</button><button className={styles.ghost} disabled={busy} onClick={()=>setEdits(null)}>{en?"Cancel":"変更をやめる"}</button>
  </section>:null}
  {message?<p className={styles.status} role="status">{message}</p>:null}
  {locked?<button className={styles.secondary} onClick={()=>{if(window.confirm(en?"Replace these edits with the saved version?":"入力を保存済みの内容に置き換えますか？")){setEdits(null);setAttempt(n=>n+1);}}}>{en?"Load saved version":"保存済みの内容を読み込む"}</button>:null}
  <section className={styles.bookActions}><button className={styles.primary} disabled={!!edits||busy} onClick={download}>{en?"Save a copy to my device":"このノートを端末に保存"}</button><p>{en?"An HTML file you can open offline. Contains your financial information; keep it somewhere private.":"オフラインでも開けるHTMLファイルです。資産情報を含むため自分だけが開ける場所に保管してください。"}</p>{review?<p>{en?"This preview resets on reload. Download a copy to keep it.":"確認用画面は再読み込みで内容が消えます。手元に残す場合は端末に保存してください。"}</p>:null}<Link href="/resolute/simulation" className={styles.secondary}>{en?"Test my rules in the simulator":"② シミュレーションで確かめる"}</Link></section>
  <p className={styles.disclaimer}>{result.disclaimer}</p>
 </div>;
}
