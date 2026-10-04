import type { Copy } from './data';
import type { MuWatchCard } from './mu-watch';
import type { WatchTile } from './company-watch';
export type WatchEarnings = {
 revision:string; ticker:'MU'; period:string; periodOrder:number; releasedOn:string; sourceUrl:string;
 publishedAt:string|null; detectedAt:string; bodyReadyAt:string; preparedAt:string; publicAt:string;
 processingMs:number; sourceToDetectionMs:number|null; detectionToPublicMs:number|null;
 method:'deterministic-issuer-numbers'; tiles:WatchTile[]; cards:MuWatchCard[]|null;
};
export type WatchEarningsFeed={ok:true;status:'ready'|'waiting'|'partial';snapshot:WatchEarnings|null;accessExpiresAt:number};
type Member={status:string;plan:string;accessExpiresAt?:number};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid watch payload');return v as Record<string,unknown>;};
const str=(v:unknown,max=800)=>{if(typeof v!=='string'||!v.length||v.length>max)throw Error('Invalid text');return v;};
const copy=(v:unknown):Copy=>{const r=object(v);return {ja:str(r.ja),en:str(r.en)};};
const clock=(v:unknown)=>{const s=str(v,40);if(!/(Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('Invalid timestamp');return s;};
const duration=(v:unknown):number|null=>{if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Invalid duration');return v;};
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
 return {...base,snapshot:{revision,ticker:'MU',period,periodOrder:s.periodOrder as number,releasedOn,sourceUrl:url.href,
 publishedAt:s.publishedAt===null?null:clock(s.publishedAt),detectedAt:clock(s.detectedAt),bodyReadyAt:clock(s.bodyReadyAt),preparedAt:clock(s.preparedAt),publicAt:clock(s.publicAt),
 processingMs:duration(s.processingMs)??0,sourceToDetectionMs:duration(s.sourceToDetectionMs),detectionToPublicMs:duration(s.detectionToPublicMs),method:'deterministic-issuer-numbers',tiles,cards}};
}
