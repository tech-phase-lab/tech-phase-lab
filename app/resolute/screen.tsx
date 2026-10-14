"use client";
import { ReviewLink as Link, usePlanClient } from "./review-context";
import { useEffect, useRef, useState } from "react";
import ToolShell from "./tool-shell";
import NumberInput from "./number-input";
import QuestionTitle from "./question-title";
import styles from "./diagnosis.module.css";
import { questions, emptyDiagnosisDraft, isQuestionVisible, selectAnswer, numericLimits, questionCopy,
 validateQuestion, draftToInput, draftToPlan, draftFromPlan, type DiagnosisDraft } from "@/lib/resolute/diagnosis-form";
import { diagnose } from "@/lib/resolute/diagnosis";
import { localizeDiagnosis, type DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import { PlanClientError } from "@/lib/resolute/plan-client";
import type { PlanSnapshot } from "@/lib/resolute/plan-data";
const messages = {
 ja: { title:"あなただけの投資ルールを30問の質問でつくる", intro:"暴落の夜も、上昇の朝も、自分のルールに立ち戻るためのキット。",
 closingFirst:"マイルールを定めれば", closingLast:"暴落も上昇も怖くない",
 start:"はじめる", redo:"回答を見直す", next:"次へ", back:"戻る", result:"結果を見る", rules:"あなたの投資ルール", advice:"このルールを使うために",
 save:"このルールを保存する", saving:"保存しています…", saved:"ルールを保存しました。", simulation:"② シミュレーションへ進む", edit:"回答に戻る",
 loading:"保存済みの計画を確認しています…", unavailable:"保存サービスを利用できません。診断は続けられますが、保存はまだできません。",
 uncertain:"保存を確認できませんでした。再送する前に、保存済みの内容を読み込んで確認してください。",
 conflict:"別の画面で計画が更新されました。この入力は上書きしていません。最新の保存内容を読み込み、回答を見直してください。",
 invalid:"入力を確認してください。数字の範囲・精度、買い増しライン、文字数のいずれかが保存条件に合っていません。",
 answer:"回答を選び、入力欄がある場合は範囲内の数字を入れてください。", text:"自由記述は1行100文字まで、10行以内にしてください。",
 reload:"保存済みの内容を読み込む（現在の入力を置き換えます）", existing:"保存済みのルールがあります。回答を見直すか、シミュレーションへ進めます。",
 private:"個人が特定できる情報は書かないでください", free:"自由記述（任意・1行に1件）",
 later:"まだ決めていない買い増しラインは空のまま保存します。", rate:"アクセスが集中しています。1分ほどおいてから保存内容を確認してください。",
 check:"確認できた保存済みの計画だけをシミュレーションに使います。" },
 en: { title:"Build your own investing rules in 30 questions.", intro:"A kit to help you return to your own rules, through sell-offs and rallies.",
 closingFirst:"With rules of your own,", closingLast:"crashes and rallies lose their grip.",
 start:"Start", redo:"Review my answers", next:"Next", back:"Back", result:"See my results", rules:"Your investing rules", advice:"Put your rules to work",
 save:"Save these rules", saving:"Saving…", saved:"Your rules are saved.", simulation:"② Open the simulator", edit:"Back to my answers",
 loading:"Checking your saved plan…", unavailable:"Saving is unavailable right now. You can finish the questions, but your rules can’t be saved yet.",
 uncertain:"We couldn’t confirm the save. Load your saved plan to check before trying again.",
 conflict:"Your plan changed in another window. Your answers haven’t overwritten it. Load the latest saved plan and review your answers.",
 invalid:"Check your numbers, purchase levels and text lengths before saving.",
 answer:"Choose an answer. If a number box appears, enter a number within the range shown.", text:"Use up to 10 lines, with no more than 100 characters on each line.",
 reload:"Load saved plan (replaces your current answers)", existing:"You have saved rules. Review your answers or open the simulator.",
 private:"Don’t include personal details about yourself or anyone else.", free:"Your own conditions (optional, one per line)",
 later:"Any purchase levels you haven’t chosen will stay blank when you save.", rate:"Too many requests. Wait about a minute, then check your saved plan.",
 check:"The simulator uses your saved plan once we’ve confirmed it was saved." },
};
const sections: Record<string,[string,string]> = { A:["生活とお金","Life and money"],B:["下落への耐え方","Handling a drop"],C:["上昇のとき","During a rally"],D:["投資のスタイル","Your approach"],E:["銘柄と集中","How your investments are spread"],F:["買い増しのルール","Extra purchases"],G:["止まるルール","When to pause"],H:["為替","Exchange rates"] };
export default function DiagnosisScreen({identityReady=true}:{identityReady?:boolean}) {
 return <ToolShell identityReady={identityReady}>{(locale,deny)=><DiagnosisForm locale={locale} deny={deny}/>}</ToolShell>;
}
function DiagnosisForm({locale,deny}:{locale:DiagnosisLocale;deny:()=>void}) {
 const requestPlan = usePlanClient();
 const [draft,setDraft]=useState<DiagnosisDraft>(emptyDiagnosisDraft), [mode,setMode]=useState<"intro"|"questions"|"result">("intro"),[index,setIndex]=useState(0);
 const [snapshot,setSnapshot]=useState<PlanSnapshot|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[saved,setSaved]=useState(false);
 const [message,setMessage]=useState<keyof typeof messages.ja|null>(null),[formError,setFormError]=useState<"answer"|"text"|null>(null),[locked,setLocked]=useState(false);
 const pending=useRef<AbortController|null>(null),mutex=useRef(false), heading=useRef<HTMLHeadingElement>(null), c=messages[locale], en=locale==="en";
 const denyRef=useRef(deny); useEffect(()=>{denyRef.current=deny;},[deny]);
 function accept(p:PlanSnapshot) {
  setSnapshot(p);setLocked(false);setSaved(false);
  setDraft(p.plan ? draftFromPlan(p.plan) : emptyDiagnosisDraft());setMessage(p.plan?"existing":null);setMode("intro");setIndex(0);
 }
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;
  void requestPlan(undefined,controller.signal).then(p=>{if(!controller.signal.aborted)accept(p);},e=>{
   if(controller.signal.aborted)return;
   if(e instanceof PlanClientError && ["signed-out","denied"].includes(e.kind)){denyRef.current();return;}
   setMessage("unavailable");
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>{pending.current?.abort();};
 },[requestPlan]);
 useEffect(()=>{if(mode!=="intro") { heading.current?.focus({preventScroll:true}); heading.current?.scrollIntoView({block:"start",behavior:"instant"}); }},[index,mode]);
 async function reload() {
  if(mutex.current)return;mutex.current=true;setLoading(true);
  const controller=new AbortController();pending.current=controller;
  try {const p=await requestPlan(undefined,controller.signal);if(!controller.signal.aborted)accept(p);}
  catch(e){if(!controller.signal.aborted){if(e instanceof PlanClientError && ["signed-out","denied"].includes(e.kind))deny();else setMessage("unavailable");}}
  finally{mutex.current=false;if(!controller.signal.aborted)setLoading(false);}
 }
 async function save() {
  if(mutex.current || !snapshot || locked)return;
  let plan;try{plan=draftToPlan(draft);}catch{setMessage("invalid");return;}
  mutex.current=true;setBusy(true);setMessage(null);
  const controller=new AbortController();pending.current=controller;
  try {const p=await requestPlan({plan,baseRevision:snapshot.revision},controller.signal);
   if(!controller.signal.aborted){setSnapshot(p);setSaved(true);setMessage("saved");}
  }catch(e){if(controller.signal.aborted)return;
   setSaved(false);
   if(e instanceof PlanClientError && ["signed-out","denied"].includes(e.kind)){deny();return;}
   setLocked(true);setMessage(e instanceof PlanClientError && e.kind==="conflict" ? "conflict" :
    e instanceof PlanClientError && e.kind==="invalid" ? "invalid" : e instanceof PlanClientError && e.kind==="rate-limited" ? "rate" : "uncertain");
  }finally{mutex.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 const visible=questions.filter(q=>isQuestionVisible(q.id,draft.answers)), q=visible[Math.min(index,visible.length-1)];
 function next() {
  try{validateQuestion(q,draft);setFormError(null);
   if(index===visible.length-1){draftToPlan(draft);setMode("result");}else setIndex(i=>i+1);
  }catch(e){setFormError(e instanceof Error && e.message==="INVALID_TEXT"?"text":"answer");}
 }
 const bodyMessage=<>{loading?<p role="status" className={styles.status}>{c.loading}</p>:null}
  {message?<p role="status" className={message==="saved" || message==="existing"?styles.status:styles.error}>{c[message]}</p>:null}</>;
 const reloadButton=<button type="button" className={styles.secondary} disabled={loading||busy} onClick={()=>void reload()}>{c.reload}</button>;
 if(mode==="intro") return <section className={`${styles.card} ${styles.introCard}`}>
  <span className={styles.eyebrow}>RULE DIAGNOSIS</span>
  <h1 className={styles.introTitle}>{en ? <><span>Build your own investing</span><span>rules in 30 questions.</span></> : <><span>あなただけの投資ルールを</span><span>30問の質問でつくる</span></>}</h1>
  <p className={styles.introDescription}>{en ? <>Build clearer rules with each answer.<br/>Takes about five minutes.</> : <>答えるほどルールは鮮明になります。<br/>※所要時間 約5分</>}</p>
  <fieldset className={styles.currencyChoice} aria-label={en?"Currency":"通貨"}>{(["JPY","USD"] as const).map(currency=><button type="button" key={currency} aria-pressed={draft.currency===currency} disabled={!!snapshot?.plan||loading} onClick={()=>{if(currency===draft.currency)return;if(Object.values(draft.answers).some(v=>v!==null)&&!window.confirm(en?"Changing currency clears your answers. Start again?":"通貨を変えると回答を消して最初から入力します。変更しますか？"))return;setDraft({...emptyDiagnosisDraft(),currency});}}>{currency==="JPY"?en?"Japanese yen · JPY":"日本円 · JPY":en?"US dollars · USD":"米ドル · USD"}</button>)}</fieldset>

  {bodyMessage}
  <button type="button" className={styles.primary} disabled={loading||locked} onClick={()=>{setMode("questions");setSaved(false);}}>{snapshot?.plan?c.redo:c.start}</button>
  {snapshot?.plan?<Link className={styles.primary} href="/resolute/notebook" prefetch={false}>{en?"Open my rulebook":"マイルールを開く"}</Link>:null}
  {snapshot?.plan?<Link className={styles.secondary} href="/resolute/simulation" prefetch={false}>{c.simulation}</Link>:null}
  {message?reloadButton:null}
 </section>;
 if(mode==="questions") {
  const text=questionCopy(q,locale,draft.currency), answer=draft.answers[q.id], option=q.o.find(o=>o.id===answer),limits=numericLimits(q,draft.answers,draft.currency);
  return <div className={styles.section}>
   <div className={styles.progress}><div className={styles.meta}><span>{sections[q.s][en?1:0]}</span><span>{index+1} / {visible.length}</span></div><progress value={index+1} max={visible.length} aria-label={en?"Progress":"進み具合"}/></div>

   <section className={styles.card} aria-labelledby="question-heading">
    <span className={styles.eyebrow}>{q.id.toUpperCase()}</span><h1 id="question-heading" aria-label={text.text} ref={heading} tabIndex={-1} className={styles.questionTitle}><QuestionTitle id={q.id} text={text.text} locale={locale}/></h1>
    {text.note?<p className={styles.muted}>{text.note}</p>:null}
    <div className={styles.options}>{text.options.map(o=><button key={o.id} type="button" className={styles.option}
     aria-pressed={Array.isArray(answer)?(answer as string[]).includes(o.id):answer===o.id}
     onClick={()=>{setFormError(null);setSaved(false);setDraft(d=>{
      const selected = d.answers[q.id];
      const current: string[] = Array.isArray(selected) ? selected : [];
      const next = current.includes(o.id) ? current.filter(x=>x!==o.id) : [...current,o.id];
      return selectAnswer(d,q.id,q.multi ? next.length ? next : null : o.id);
     });}}>{o.label}</button>)}</div>
    {option?.input?<label className={styles.field} htmlFor={`number-${q.id}`}>{en?"Enter a number":"数字を入力"} ({limits.money?draft.currency==="USD"?"USD":en?"JPY":"円":q.id==="q30"?en?"yen":"円":q.id==="q04"||q.id==="q05"?en?"months":"か月":"%"})
     <NumberInput id={`number-${q.id}`} decimal={!limits.money||draft.currency==="USD"} min={limits.min} max={limits.max} step={limits.step} value={draft.numbers[q.id]??""}
      aria-describedby={`range-${q.id}`} onValueChange={value=>{setFormError(null);setDraft(d=>({...d,numbers:{...d.numbers,[q.id]:value}}));}}/>
     <span id={`range-${q.id}`} className={styles.muted}>{limits.min.toLocaleString()}–{limits.max.toLocaleString()}{q.id==="q25"?(en?" (keeps every step below 100%)":"（すべての段階が100%未満になる範囲）"):""}</span>
    </label>:null}
    {q.free?<label className={styles.field}>{c.free}<textarea value={draft[q.free].join("\n")} onChange={e=>{const field=q.free!;setDraft(d=>({...d,[field]:e.target.value.split("\n")}));}} aria-describedby="privacy-note"/><span id="privacy-note" className={styles.muted}>{c.private}</span></label>:null}
    {formError?<p className={styles.error} role="alert">{c[formError]}</p>:null}
    <div className={`${styles.nav} ${styles.questionNav}`}><button type="button" className={styles.secondary} onClick={()=>{setFormError(null);if(index===0)setMode("intro");else setIndex(i=>i-1);}}>{c.back}</button>
     <button type="button" className={styles.primary} onClick={next}>{index===visible.length-1?c.result:c.next}</button></div>
   </section>
  </div>;
 }
 const input=draftToInput(draft),result=localizeDiagnosis(diagnose(input),input,locale);
 return <div className={styles.section}>
  <section className={`${styles.card} ${styles.hero}`}><span className={styles.eyebrow}>{en?"YOUR APPROACH":"あなたのタイプ"}</span>
   <h1 className={styles.type} ref={heading} tabIndex={-1}>{result.typeName}</h1><hr className={`${styles.divider} ${styles.typeDivider}`}/><p className={styles.typeDetail}>{result.typeDetail}</p></section>
  <section className={styles.card}><h2>{c.rules}</h2><dl className={styles.ruleCards}>{result.rows.map(row=><div className={styles.ruleCard} key={row.item}><dt>{row.item}</dt><dd>{row.rule}</dd><dd className={styles.muted}>{row.meaning}</dd></div>)}</dl></section>
  <section className={styles.card}><h2>{c.advice}</h2><ol className={styles.advice}>{result.advice.map(a=><li key={a.id}>{a.text}</li>)}</ol></section>
  <p className={styles.closing}><span>{c.closingFirst}</span><span>{c.closingLast}</span></p>
  <section className={styles.card}><p className={styles.muted}>{result.disclaimer}</p>
   {!result.buyLines.length&&draft.answers.q24!=="none"?<p className={styles.muted}>{c.later}</p>:null}
   {bodyMessage}<button type="button" className={styles.primary} disabled={busy||loading||locked||!snapshot||saved} onClick={()=>void save()}>{busy?c.saving:c.save}</button>
   {saved?<Link className={`${styles.primary} ${styles.continueButton}`} href="/resolute/simulation" prefetch={false}>{c.simulation}</Link>:null}
   <button type="button" className={styles.secondary} disabled={busy||loading} onClick={()=>{setMode("questions");setSaved(false);setMessage(null);}}>{c.edit}</button>
   {!snapshot||locked?reloadButton:null}<p className={styles.muted}>{c.check}</p>
  </section>
 </div>;
}
