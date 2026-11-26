"use client";
import type {ReactNode} from 'react';
import {ReviewLink as Link} from '../review-context';
import s from './reference.module.css';

/** YOUR RULES (owner, Nov 25): four picture tiles (the rulebook's cover, a lock-screen preview, a gold line chart, a receipt drawn
 * in thin gold lines: owner, Nov 26 §5, in place of the gold ¥ coin),
 * all the same height: 2×2 on a phone, four across on a PC. The lock-screen preview shows the member's own saved numbers
 * when this tab already knows them, otherwise only the time and the name. */
export function RuleTiles({locale,lockNumbers}:{locale:'ja'|'en';lockNumbers:{tolerancePct:number|null;perStockCapPct:number}|null}){
 const en=locale==='en';
 const tiles:[string,string,string,string,string,ReactNode][]=[
  ['notebook','迷った日の一冊','Your rulebook','ルールを一冊に','Your rules in one place',<span key="b" className={s.picBook}><b>RESOLUTE</b><i>R</i></span>],
  ['wall','ルールのお守り','Rules wallpaper','壁紙をつくる','Make your wallpaper',<span key="w" className={s.picPhone}><b>9:41</b><small>RESOLUTE</small>{lockNumbers?<>{lockNumbers.tolerancePct!==null?<><em>{en?'Loss you can accept':'許容できる下落'}</em><strong>−{lockNumbers.tolerancePct}%</strong></>:null}<em>{en?'Per-stock cap':'1銘柄の上限'}</em><strong>{en?`${lockNumbers.perStockCapPct}% of assets`:`資産の${lockNumbers.perStockCapPct}%`}</strong></>:null}</span>],
  ['simulation','資産シミュ','Portfolio simulator','下落と上昇を試す','Explore ups and downs',<svg key="c" className={s.picChart} viewBox="0 0 120 70" aria-hidden="true"><defs><linearGradient id="tile-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8b36a" stopOpacity=".35"/><stop offset="1" stopColor="#d8b36a" stopOpacity="0"/></linearGradient></defs><path d="M4 48 C20 50 26 64 42 58 S64 30 78 36 98 22 116 6 L116 70 L4 70Z" fill="url(#tile-fill)"/><path d="M4 48 C20 50 26 64 42 58 S64 30 78 36 98 22 116 6" fill="none" stroke="#f3dfae" strokeWidth="1.8"/><path d="M4 50 C30 60 60 64 116 66" fill="none" stroke="#8aa0c8" strokeWidth="1" strokeDasharray="3 3"/><circle cx="116" cy="6" r="2.6" fill="#fff3cf"/></svg>],
  ['tax','税金の目安','Tax estimate','手取りの目安','Estimate what you keep',<svg key="t" className={s.picReceipt} viewBox="0 0 60 80" aria-hidden="true"><path d="M8 4H52V70L47.6 74 43.2 70 38.8 74 34.4 70 30 74 25.6 70 21.2 74 16.8 70 12.4 74 8 70Z" fill="#141a2b" stroke="#e3c17a" strokeWidth="1.6" strokeLinejoin="round"/><path d="M16 18H44M16 27H38M16 36H44" stroke="#e3c17a" strokeWidth="1.6" strokeLinecap="round"/><path d="M31 54H44" stroke="#e3c17a" strokeWidth="2.6" strokeLinecap="round"/></svg>],
 ];
 return <div className={s.ruleGrid}>{tiles.map(([path,ja,eng,sub,subEn,pic])=><Link key={path} className={s.ruleTile} href={`/resolute/${path}`}>
  <span className={s.pic} aria-hidden="true">{pic}</span><b>{en?eng:ja}</b><span>{en?subEn:sub}</span></Link>)}</div>;
}

const icon={bell:'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',moon:'M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z',sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'};
const Icon=({d}:{d:string})=><i className={s.alertIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d={d}/></svg></i>;

/** ALERTS (owner, Nov 25): one panel, three rows. 翌朝のひとこと is an on/off switch that saves the member's setting. */
export function AlertsPanel({locale,expiry,sampleLabel,morning,saving,onMorning}:{locale:'ja'|'en';expiry:string;sampleLabel:boolean;morning:boolean|null;saving:boolean;onMorning:((on:boolean)=>void)|null}){
 const en=locale==='en';
 return <div className={s.alerts}>
  <Link className={s.alertRow} href="/resolute/alerts"><Icon d={icon.bell}/><div><b>{en?'Closing-price alerts':'終値アラート'}</b><span>{expiry}</span>{sampleLabel?<small className={s.sampleLabel}>{en?'Display sample':'表示見本'}</small>:null}</div><em>{en?'Settings →':'設定 →'}</em></Link>
  <Link className={s.alertRow} href="/resolute/tonight"><Icon d={icon.moon}/><div><b>{en?'When the market tumbles':'暴落の夜に開く'}</b><span>{en?'A moment to breathe':'今夜のひと息'}</span></div><em>{en?'Open →':'開く →'}</em></Link>
  <div className={s.alertRow}><Icon d={icon.sun}/><div><b>{en?'A note the next morning':'翌朝のひとこと'}</b><span>{en?'One note the morning after an alert':'アラートの翌朝に1通'}</span></div>
   <button type="button" role="switch" className={s.switch} aria-checked={morning===true} aria-label={en?'A note the next morning':'翌朝のひとこと'} disabled={morning===null||saving||!onMorning} onClick={()=>onMorning?.(!morning)}><i/></button></div>
 </div>;
}
