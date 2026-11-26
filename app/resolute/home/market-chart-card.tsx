"use client";
import {useState} from 'react';
import {gaugeReading,gaugeStatus,temperatureLabels,type ThermometerSnapshot} from '@/lib/resolute/thermometer-view';
import {THERMOMETER_NOTE} from '@/lib/resolute/thermometer-copy';
import {ReviewLink as Link} from '../review-context';
import s from './reference.module.css';

type Index='nas100'|'sox';
const NAME={nas100:{ja:'TP大型株100',en:'TP Large Cap 100'},sox:{ja:'TP半導体40',en:'TP Semiconductor 40'}} as const;
const signed=(n:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(1)}%`;
const W=300,H=120,PAD=6;

/** The chart line's points (x, y in the 300×120 box) for a level series: oldest left, the last session right. */
export function chartPoints(line:readonly {close:number}[]){
 if(line.length<2)return [];
 const values=line.map(b=>b.close),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 return values.map((v,i)=>({x:Math.round(i/(values.length-1)*W*10)/10,y:Math.round((PAD+(1-(v-min)/span)*(H-PAD*2))*10)/10}));
}

/** Home chart card (owner, Nov 25: 01 ホーム): TP大型株100 / TP半導体40 tabs, the gauge stage, the day's move (up green, down red)
 * and the last three months as a line that draws left to right once, the last close glowing. Replaces the separate gauge card;
 * its one-line note stays small underneath. Every number is the stored gauge snapshot; nothing is drawn without it. */
export default function MarketChartCard({locale,snapshot,sample=false}:{locale:'ja'|'en';snapshot?:ThermometerSnapshot;sample?:boolean}){
 const en=locale==='en',[index,setIndex]=useState<Index>('nas100');
 const reading=sample?null:gaugeReading(snapshot,index);
 const label=sample?temperatureLabels[locale][4]:reading?temperatureLabels[locale][reading.band]:gaugeStatus(snapshot,index,en);
 const move=reading?snapshot?.moves?.[index]?.changePercent??null:null;
 const line=reading?snapshot?.trail?.[index]??null:null,points=line?chartPoints(line):[];
 const d=points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '),last=points.at(-1);
 const close=reading?new Intl.DateTimeFormat(en?'en-US':'ja-JP',{month:en?'short':'numeric',day:'numeric',timeZone:'UTC'}).format(new Date(reading.asOf+'T12:00:00Z')):null;
 return <><div className={s.chartCard}>
  <div className={s.chartTabs} role="group" aria-label={en?'Index':'指数'}>{(['nas100','sox'] as const).map(i=><button key={i} type="button" aria-pressed={index===i} onClick={()=>setIndex(i)}>{NAME[i][locale]}</button>)}</div>
  <div className={s.chartHead} aria-live="polite" aria-atomic="true">
   <Link href="/resolute/thermometer" className={`${s.chartStage} ${reading||sample?'':s.chartWaiting}`}>{label}</Link>
   {move!==null?<span className={move>0?s.up:move<0?s.down:''}>{signed(move)}</span>:null}
   {sample?<small>{en?'Display sample':'表示見本'}</small>:close?<small>{en?`${close} close${points.length?' · 3 months':''}`:`${close} 終値${points.length?'・3か月':''}`}</small>:null}
  </div>
  {d&&last?<div className={s.chartBox}><svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
   <defs><linearGradient id={`fill-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8b36a" stopOpacity=".38"/><stop offset="1" stopColor="#d8b36a" stopOpacity="0"/></linearGradient></defs>
   <path key={`a-${index}`} className={s.chartArea} d={`${d} L${W} ${H} L0 ${H} Z`} fill={`url(#fill-${index})`}/>
   <path key={`l-${index}`} className={s.chartLine} d={d} pathLength={1}/>
  </svg><i key={`p-${index}`} className={`${s.chartDot} ${move!==null&&move<0?s.dotDown:''}`} style={{left:`${last.x/W*100}%`,top:`${last.y/H*100}%`}} aria-hidden="true"/></div>:null}
 </div><p className={s.chartNote}>{THERMOMETER_NOTE[locale]}</p></>;
}

/** PC: the needle meter beside 今日やること (02_ホーム_PC). TP大型株100, as on the gauge page's first view. */
export function NeedleCard({locale,snapshot,sample=false}:{locale:'ja'|'en';snapshot?:ThermometerSnapshot;sample?:boolean}){
 const en=locale==='en',reading=sample?null:gaugeReading(snapshot,'nas100');
 const score=sample?86:reading?.score;
 const label=sample?temperatureLabels[locale][4]:reading?temperatureLabels[locale][reading.band]:gaugeStatus(snapshot,'nas100',en);
 const ticks=Array.from({length:5},(_,k)=>{const a=(180-k*45)*Math.PI/180;return {x1:150+96*Math.cos(a),y1:150-96*Math.sin(a),x2:150+84*Math.cos(a),y2:150-84*Math.sin(a)};});
 return <div className={s.needleCard}>
  <div className={s.row}><h2>{en?'Market gauge':'相場の温度計'}</h2><Link className={s.more} href="/resolute/thermometer">{en?'Details →':'くわしく →'}</Link></div>
  <small className={s.sampleLabel}>{NAME.nas100[locale]}{sample?` · ${en?'Display sample':'表示見本'}`:reading?` · ${reading.asOf} ${en?'US market close':'米国市場の終値'}`:''}</small>
  <svg className={s.needleSvg} viewBox="0 0 300 165" aria-hidden="true">
   <defs><linearGradient id="needle-arc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5d86c0"/><stop offset=".55" stopColor="#d8b36a"/><stop offset="1" stopColor="#e0604c"/></linearGradient></defs>
   <path d="M44 150 A106 106 0 0 1 256 150" fill="none" stroke="url(#needle-arc)" strokeWidth="13" strokeLinecap="round" opacity={score!==undefined?1:.3}/>
   {ticks.map((t,k)=><line key={k} {...t} stroke="#0a1018" strokeWidth="2"/>)}
   {score!==undefined?<line x1="150" y1="150" x2="150" y2="66" stroke="#f3dfae" strokeWidth="3" strokeLinecap="round" transform={`rotate(${score*1.8-90} 150 150)`}/>:null}
   <circle cx="150" cy="150" r="7" fill="#f3dfae"/>
  </svg>
  <div className={s.needleLabel} aria-live="polite">{label}</div>
  <div className={s.scale}><span>{en?'Cool':'冷えている'}</span><span>{en?'Hot':'熱い'}</span></div>
  <p className={s.chartNote}>{THERMOMETER_NOTE[locale]}</p>
 </div>;
}
