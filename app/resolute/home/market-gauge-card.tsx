"use client";
import { ReviewLink as Link } from '../review-context';
import { gaugeReading, gaugeStatus, temperatureLabels, type ThermometerSnapshot } from '@/lib/resolute/thermometer-view';
import s from './reference.module.css';
/** Home always summarizes NASDAQ100, matching the detail page's initial selection. */
export default function MarketGaugeCard({locale,snapshot,sample=false}:{locale:'ja'|'en';snapshot?:ThermometerSnapshot;sample?:boolean}) {
 const en=locale==='en',reading=sample?null:gaugeReading(snapshot,'nas100');
 const score=sample?86:reading?.score;
 const label=sample?temperatureLabels[locale][4]:reading?temperatureLabels[locale][reading.band]:gaugeStatus(snapshot,'nas100',en);
 return <div className={s.card}>
  <div className={s.row}><h2>{en?'Market gauge':'相場の温度計'}</h2><Link className={s.more} href="/resolute/thermometer">{en?'Details →':'くわしく →'}</Link></div>
  <div className={`${s.temp} ${score!==undefined?s.sample:''}`} aria-live="polite" aria-atomic="true">
   <small className={s.sampleLabel}>NASDAQ100</small>
   <div className={s.big}>{label}</div>
   {sample?<small className={s.sampleLabel}>{en?'Display sample':'表示見本'}</small>:reading?<small className={s.sampleLabel}>{reading.asOf} {en?'US market close':'米国市場の終値'}</small>:null}
   <div className={s.track} aria-hidden="true">{score!==undefined?<i className={s.needle} style={{left:`${score}%`}}/>:null}</div>
   <div className={s.scale}><span>{en?'Cool':'冷えている'}</span><span>{en?'Hot':'熱い'}</span></div>
  </div>
 </div>;
}
