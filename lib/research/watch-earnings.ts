import type { Copy } from './data';
import type { MuWatchCard } from './mu-watch';
import type { WatchTile } from './company-watch';
export type WatchEarnings = {
 revision:string; ticker:'MU'; period:string; periodOrder:number; releasedOn:string; sourceUrl:string;
 publishedAt:string|null; detectedAt:string; bodyReadyAt:string; preparedAt:string; publicAt:string;
 processingMs:number; sourceToDetectionMs:number|null; detectionToPublicMs:number|null;
 method:'deterministic-issuer-numbers'; tiles:WatchTile[]; cards:MuWatchCard[]|null;
 /** 決算の深掘り: PRO only. The numbers arrive first; the summary is added after (summary null = まとめ 準備中). */
 dive:Dive|null;
};
export type DiveChip={tone:'up'|'down'|'gold';text:Copy};
export type DiveSection={key:'happened'|'good'|'watch'|'means'|'view';text:Copy};
export type DiveCard={headline:Copy;chips:DiveChip[];sections:DiveSection[];segment?:string|null};
export type DiveSegment={key:string;nameJa:string;nameEn:string;revenue:number;previous:number;operatingMargin:number;previousOperatingMargin:number};
export type DiveNumbers={revenue:{current:number;previous:number;yearAgo:number|null};adjustedEPS:number|null;epsEstimate:number|null;grossMargin:{current:number;previous:number}|null;guidance:{low:number;high:number;grossMarginPercent:number|null}|null;segments:DiveSegment[]|null};
export type DiveSummary={conclusion:Copy[];cards:Partial<Record<'growth'|'change'|'caution'|'next',DiveCard>>};
export type Dive={numbers:DiveNumbers|null;summary:DiveSummary|null;summaryAt:string|null;failed:boolean};
/** Quarterly revenue for the chart (earlier bars from the SEC), in million USD. */
export type DiveHistory={label:string;end:string;value:number};
export type WatchEarningsFeed={ok:true;status:'ready'|'waiting'|'partial';snapshot:WatchEarnings|null;accessExpiresAt:number;history?:DiveHistory[]};
type Member={status:string;plan:string;accessExpiresAt?:number};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid watch payload');return v as Record<string,unknown>;};
const str=(v:unknown,max=800)=>{if(typeof v!=='string'||!v.length||v.length>max)throw Error('Invalid text');return v;};
const copy=(v:unknown):Copy=>{const r=object(v);return {ja:str(r.ja),en:str(r.en)};};
const clock=(v:unknown)=>{const s=str(v,40);if(!/(Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('Invalid timestamp');return s;};
const duration=(v:unknown):number|null=>{if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Invalid duration');return v;};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nullable=(v:unknown):number|null=>v===null||v===undefined?null:finite(v)?v:(()=>{throw Error('Invalid number');})();
/** A dive that does not fit is dropped as a whole (the screen then says 確認中); it never breaks the rest of the page. */
export function parseDive(raw:unknown):Dive|null{
 try{
  if(!raw||typeof raw!=='object')return null;
  const r=raw as Record<string,unknown>;
  let numbers:DiveNumbers|null=null;
  if(r.numbers){
   const n=object(r.numbers),rev=object(n.revenue);
   if(!finite(rev.current)||!finite(rev.previous))throw Error('Invalid revenue');
   const gm=n.grossMargin?object(n.grossMargin):null,gd=n.guidance?object(n.guidance):null;
   numbers={revenue:{current:rev.current,previous:rev.previous,yearAgo:nullable(rev.yearAgo)},adjustedEPS:nullable(n.adjustedEPS),epsEstimate:nullable(n.epsEstimate),
    grossMargin:gm?{current:nullable(gm.current) as number,previous:nullable(gm.previous) as number}:null,
    guidance:gd?{low:nullable(gd.low) as number,high:nullable(gd.high) as number,grossMarginPercent:nullable(gd.grossMarginPercent)}:null,
    segments:Array.isArray(n.segments)?n.segments.map(v=>{const s=object(v);return {key:str(s.key,20),nameJa:str(s.nameJa,60),nameEn:str(s.nameEn,60),revenue:nullable(s.revenue) as number,previous:nullable(s.previous) as number,operatingMargin:nullable(s.operatingMargin) as number,previousOperatingMargin:nullable(s.previousOperatingMargin) as number};}):null};
  }
  let summary:DiveSummary|null=null;
  if(r.summary){
   const s=object(r.summary);if(!Array.isArray(s.conclusion)||s.conclusion.length<1||s.conclusion.length>3)throw Error('Invalid conclusion');
   const cardsIn=object(s.cards),cards:DiveSummary['cards']={};
   for(const key of ['growth','change','caution','next'] as const){
    if(cardsIn[key]===undefined)continue;
    const c=object(cardsIn[key]);
    if(!Array.isArray(c.chips)||c.chips.length>3||!Array.isArray(c.sections)||c.sections.length<1||c.sections.length>4)throw Error('Invalid card');
    cards[key]={headline:copy(c.headline),segment:typeof c.segment==='string'?c.segment:null,
     chips:c.chips.map(v=>{const chip=object(v);if(!['up','down','gold'].includes(String(chip.tone)))throw Error('Invalid tone');return {tone:chip.tone as DiveChip['tone'],text:copy(chip.text)};}),
     sections:c.sections.map(v=>{const sec=object(v);if(!['happened','good','watch','means','view'].includes(String(sec.key)))throw Error('Invalid section');return {key:sec.key as DiveSection['key'],text:copy(sec.text)};})};
   }
   summary={conclusion:s.conclusion.map(copy),cards};
  }
  const summaryAt=r.summaryAt===null||r.summaryAt===undefined?null:clock(r.summaryAt);
  return {numbers,summary:numbers?summary:null,summaryAt:numbers&&summary?summaryAt:null,failed:!!r.summaryReason&&!summary};
 }catch{return null;}
}
export function watchEarningsPayload(raw:unknown,member:Member,now=Date.now()):WatchEarningsFeed {
 const r=object(raw);if(r.ok!==true||!['ready','waiting','partial'].includes(String(r.status)))throw Error('Invalid feed');
 const paid=member.status==='signed-in'&&member.plan==='pro'&&Number.isFinite(member.accessExpiresAt)&&member.accessExpiresAt!>now;
 const base={ok:true as const,status:r.status as WatchEarningsFeed['status'],accessExpiresAt:paid?member.accessExpiresAt!:0};
 if(r.snapshot===null)return {...base,snapshot:null};
 const s=object(r.snapshot);const url=new URL(str(s.sourceUrl,2000));
 if(url.protocol!=='https:'||url.hostname!=='investors.micron.com'||url.username||url.password||s.ticker!=='MU'||s.method!=='deterministic-issuer-numbers')throw Error('Invalid source');
 const revision=str(s.revision,64);if(!/^[a-f0-9]{64}$/.test(revision))throw Error('Invalid revision');
 const period=str(s.period,20);const match=/^FQ([1-4]) (20\d{2})$/.exec(period);
 if(!match||s.periodOrder!==Number(match[2])*4+Number(match[1]))throw Error('Invalid quarter');
 const releasedOn=str(s.releasedOn,10);if(!/^20\d{2}-\d{2}-\d{2}$/.test(releasedOn)||!Number.isFinite(Date.parse(releasedOn)))throw Error('Invalid date');
 if(!Array.isArray(s.tiles)||s.tiles.length!==3||!Array.isArray(s.cards)||s.cards.length!==4)throw Error('Invalid presentation');
 const tiles=s.tiles.map(v=>{const t=object(v);return {label:copy(t.label),value:copy(t.value),note:copy(t.note)};});
 const cards=paid?s.cards.map(v=>{const c=object(v);if(!Array.isArray(c.points)||c.points.length<1||c.points.length>6)throw Error('Invalid cards');return {title:copy(c.title),headline:copy(c.headline),points:c.points.map(copy),detail:copy(c.detail),sourceSection:str(c.sourceSection)};}):null;
 return {...base,snapshot:{dive:paid?parseDive(s.dive):null,revision,ticker:'MU',period,periodOrder:s.periodOrder as number,releasedOn,sourceUrl:url.href,
 publishedAt:s.publishedAt===null?null:clock(s.publishedAt),detectedAt:clock(s.detectedAt),bodyReadyAt:clock(s.bodyReadyAt),preparedAt:clock(s.preparedAt),publicAt:clock(s.publicAt),
 processingMs:duration(s.processingMs)??0,sourceToDetectionMs:duration(s.sourceToDetectionMs),detectionToPublicMs:duration(s.detectionToPublicMs),method:'deterministic-issuer-numbers',tiles,cards}};
}
