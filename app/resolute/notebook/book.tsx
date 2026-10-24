"use client";
import { useEffect,useRef,useState } from "react";
import type { PlanSnapshot } from "@/lib/resolute/plan-data";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import { rulebookChapters,bookMoney } from "@/lib/resolute/rulebook";
import styles from "../diagnosis.module.css";
export default function Rulebook({plan,locale}:{plan:NonNullable<PlanSnapshot["plan"]>;locale:DiagnosisLocale}) {
 const chapters=rulebookChapters(plan,locale),en=locale==="en";
 const [index,setIndex]=useState(0),[turn,setTurn]=useState<{from:number;to:number}|null>(null);
 const stage=useRef<HTMLElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),locked=useRef(false),touch=useRef<{x:number;y:number}|null>(null);
 const current=Math.min(index,chapters.length),visible=turn?.to??current;
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 function move(to:number) {
  if(locked.current||to<0||to>chapters.length||to===current)return;
  locked.current=true;
  const finish=()=>{setIndex(to);setTurn(null);locked.current=false;stage.current?.focus({preventScroll:true});if(stage.current&&stage.current.getBoundingClientRect().top<0)stage.current.scrollIntoView({block:"start",behavior:"instant"});};
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){finish();return;}
  setTurn({from:current,to});timer.current=setTimeout(finish,580);
 }
 function page(number:number) {
  if(number===0)return <div className={styles.boundCover}><div className={styles.coverFrame}><span className={styles.coverBrand}>RESOLUTE</span><span className={styles.coverEdition}>THE PERSONAL EDITION</span><div className={styles.coverSeal} aria-hidden="true"><span>R</span></div><h2>{en?<>My rules<br/>My resolve</>:<>相場に揺れない<br/>私のルール</>}</h2><div className={styles.coverRule}/><p>{en?<>Written from my answers<br/>Kept for the days that test them</>:<>自分の答えからつくる<br/>迷った日に立ち戻る一冊</>}</p><small>{plan.currency} · {new Date(plan.updatedAt).toLocaleDateString(en?"en-US":"ja-JP",{timeZone:"Asia/Tokyo"})}</small></div></div>;
  const chapter=chapters[number-1];
  return <div className={styles.paperPage}><div className={styles.paperRunning}><span>RESOLUTE</span><span>MY RULES</span></div><span className={styles.chapterKicker}>{chapter.kicker}</span><h2>{chapter.title}</h2><p className={styles.chapterLead}>{chapter.lead}</p>
   {chapter.metrics.length?<dl className={styles.chapterMetrics}>{chapter.metrics.map(metric=><div key={metric.label} data-text={metric.text||undefined}><dt>{metric.label}</dt><dd>{metric.value}</dd>{metric.detail?<dd className={styles.metricDetail}>{metric.detail}</dd>:null}</div>)}</dl>:null}
   {chapter.lines?.length?<ol className={styles.purchaseLadder}>{chapter.lines.map((line,i)=><li key={line.dropPct}><span className={styles.ladderDot}>{i+1+(Number(chapter.id.split('-').at(-1))||0)*3}</span><div><strong>−{line.dropPct}%</strong><span>{en?"from reference price":"基準株価から"}</span></div><b>{bookMoney(line.amount,plan.currency,locale)}</b></li>)}</ol>:null}
   <div className={styles.chapterProse}>{chapter.paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div>
   {chapter.practice?<section className={styles.chapterPractice}><h3>{chapter.practice.title}</h3><ol>{chapter.practice.steps.map(step=><li key={step}>{step}</li>)}</ol></section>:null}{chapter.closing?<p className={styles.chapterClosing}>{chapter.closing}</p>:null}
   <footer className={styles.paperFolio}><span>{en?"A promise to myself":"自分との約束"}</span><span>{String(number).padStart(2,"0")}</span></footer>
  </div>;
 }
 return <div className={styles.reader}>
  <article ref={stage} tabIndex={0} className={styles.boundBook} aria-label={en?"My investing rulebook":"私の投資ルール"} aria-roledescription={en?"Book":"本"}
   onKeyDown={event=>{if(event.key==="ArrowRight"){event.preventDefault();move(current+1);}if(event.key==="ArrowLeft"){event.preventDefault();move(current-1);}}}
   onPointerDown={event=>{if(event.pointerType==="touch")touch.current={x:event.clientX,y:event.clientY};}}
   onPointerCancel={()=>{touch.current=null;}}
   onPointerUp={event=>{const start=touch.current;touch.current=null;if(!start||event.pointerType!=="touch")return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*2)move(current+(dx<0?1:-1));}}>
   <div className={styles.bookRibbon} aria-hidden="true"/>
   <div className={styles.bookStill}>{page(visible)}</div>
   {turn?<div className={`${styles.turningLeaf} ${turn.to>turn.from?styles.leafForward:styles.leafBack}`} aria-hidden="true">{page(turn.to>turn.from?turn.from:turn.to)}</div>:null}
  </article>
  <nav className={styles.readerControls} aria-label={en?"Turn pages":"ページをめくる"}>
   <button type="button" disabled={current===0||turn!==null} onClick={()=>move(current-1)} aria-label={en?"Previous page":"前のページ"}>←</button>
   <span role="status" aria-live="polite">{current===0?(en?"COVER":"表紙"):`${String(current).padStart(2,"0")} / ${String(chapters.length).padStart(2,"0")}`}</span>
   <button type="button" disabled={current===chapters.length||turn!==null} onClick={()=>move(current+1)} aria-label={current===0?(en?"Open my book":"本を開く"):(en?"Next page":"次のページ")}>{current===0?(en?"Open →":"開く →"):"→"}</button>
  </nav>
  <p className={styles.readerHint}>{en?"Swipe or use the arrows to turn the page":"スワイプか矢印でページをめくれます"}</p>
  {current>0?<button type="button" className={styles.returnCover} disabled={!!turn} onClick={()=>move(0)}>{en?"Back to the cover":"表紙に戻る"}</button>:null}
 </div>;
}
