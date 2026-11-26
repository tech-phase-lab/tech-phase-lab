"use client";
import {useEffect,useState} from 'react';
import ToolShell from '../tool-shell';
import {ReviewLink as Link,useReview,useNotificationClient} from '../review-context';
import {useRisk,riskStatus} from '../features/use-risk';
import {ShockGaugeTitle} from '../features/shock-gauge';
import {validateSnapshot} from '@/lib/resolute/transport';
import {formatDisplay} from '@/lib/research/display-time';
import s from './reference.module.css';
import MarketChartCard,{NeedleCard} from './market-chart-card';
import TodayCard,{useTodayMember} from './today-card';
import ds from '../diagnosis.module.css';
import {ShockCards,ShockList} from './shock-section';
import {useImpactMember} from '../features/use-impact-member';
import {AlertsPanel,RuleTiles} from './rules-alerts';
import { useThermometerSnapshot } from '../use-thermometer-snapshot';
import { useDesktop } from '../use-desktop';
import { useFreshHome } from './use-fresh-home';
import type { ThermometerSnapshot } from '@/lib/resolute/thermometer-view';
import type { NotificationSnapshot } from '@/lib/resolute/notification-settings';
import type { PlanSnapshot } from '@/lib/resolute/plan-data';
import { useRemembered } from '../features/use-remembered';
import { renewalHref } from '@/lib/resolute/renewal-link';
type Snapshot=ReturnType<typeof validateSnapshot>;
/** The Shock Gauge section's anchor: the PC menu's 衝撃度チェッカー scrolls here (owner, Nov 25: no detail page on a PC). */
export const SHOCK_GAUGE_ANCHOR='shock-gauge';
export default function HomeScreen({identityReady=true,snapshot}:{identityReady?:boolean;snapshot?:ThermometerSnapshot}) {
 const current = useThermometerSnapshot(snapshot),epoch = useFreshHome();
 return <ToolShell home pc identityReady={identityReady}>{(locale,_deny,entitlement)=><Home key={epoch} locale={locale} entitlement={entitlement} thermometerSnapshot={current}/>}</ToolShell>;
}
export function Home({locale,entitlement,thermometerSnapshot}:{thermometerSnapshot?:ThermometerSnapshot;locale:'ja'|'en';entitlement:Snapshot|null}) {
 const en=locale==='en',review=useReview(),live=useRisk(),pc=useDesktop();
 const {feed,status}=live;
 const available=status==='ready'&&feed?.state==='ready';
 const high=available&&feed.articles.some(a=>a.stars!==null&&a.stars>=4);
 const displaySample=!!review&&review.scenario!=='live';
 const previewExpired=review?.scenario==='expired';
 const locked=previewExpired||!review&&entitlement!==null&&!entitlement.canReceiveNotifications;
 const requestSettings=useNotificationClient();
 // First paint (#869): the home is drawn once, in its final order, when the day's feed and the member's own lines (and the AI
 // plan, asked at the same time) are known. Until then the RESOLUTE loader stays, the same one the access check shows.
 const member=useTodayMember(!locked,!displaySample);
 // あなたへの影響 (owner, Nov 26 spec §4): the member's holdings (this device), watchlist and diagnosis sector, read on the device.
 const impactMember=useImpactMember(!locked&&!displaySample);
 const firstPaint=status!=='loading'&&(locked||!available||member!==undefined);
 // What this tab already knows is shown at once instead of a dash (owner, Nov 17); both are refreshed right after.
 const knownSettings=useRemembered<NotificationSnapshot>('notifications'),knownPlan=useRemembered<PlanSnapshot>('plan');
 const [settings,setSettings]=useState<NotificationSnapshot|null>(knownSettings??null),[saving,setSaving]=useState(false);
 const [date,setDate]=useState<string|null>(()=>typeof window==='undefined'?null:formatDisplay(new Date(),en?'en':'ja',{dateStyle:'full'}));
 const [offer,setOffer]=useState<{ja:number;en:number}|null>(null);
 useEffect(()=>{const c=new AbortController();let busy=false;
  const load=async()=>{if(busy)return;busy=true;try{const next=await requestSettings(undefined,c.signal);if(!c.signal.aborted)setSettings(next);}catch{if(!c.signal.aborted)setSettings(null);}finally{busy=false;}};
  void load();const timer=setInterval(()=>void load(),60000);return()=>{c.abort();clearInterval(timer);};
 },[requestSettings]);
 // 翌朝のひとこと switch: saves only morningEnabled on the member's current settings; a conflict or failure reloads what is stored.
 const setMorning=async(on:boolean)=>{if(!settings||saving)return;setSaving(true);
  try{setSettings(await requestSettings({settings:{...settings.settings,morningEnabled:on},baseRevision:settings.revision}));}
  catch{try{setSettings(await requestSettings());}catch{setSettings(null);}}finally{setSaving(false);}};
 useEffect(()=>{const update=()=>setDate(formatDisplay(new Date(),en?'en':'ja',{dateStyle:'full'}));update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[en]);
 useEffect(()=>{if(!locked||review)return;const c=new AbortController();void fetch('/api/resolute/renewal-offer',{cache:'no-store',credentials:'same-origin',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const v=await r.json();if((v.ja===5980&&v.en===39)||(v.ja===3980&&v.en===29))setOffer(v);}).catch(()=>{});return()=>c.abort();},[locked,review]);
 // Opened from the PC menu's 衝撃度チェッカー (/resolute#shock-gauge): the section is drawn after the access check, so scroll once it is there.
 useEffect(()=>{if(typeof window!=='undefined'&&window.location.hash==='#'+SHOCK_GAUGE_ANCHOR)document.getElementById(SHOCK_GAUGE_ANCHOR)?.scrollIntoView({block:'start'});},[pc,status,firstPaint]);
 const displayOffer=previewExpired?{ja:5980,en:39}:offer;
 const expiry=displaySample?'2028-01-15T00:00:00+09:00':entitlement?.alerts.expiresAt;
 const plan=knownPlan?.plan,lockNumbers=plan?{tolerancePct:plan.tolerancePct,perStockCapPct:plan.perStockCapPct}:null;
 const today=!locked&&available?<TodayCard locale={locale} feed={feed} snapshot={thermometerSnapshot} member={member} pc={pc}/>:null;
 const shock=<div id={SHOCK_GAUGE_ANCHOR} className={`${s.card} ${pc?s.shockPc:''} ${high&&!locked?s.high:''}`}><div className={s.row}><h2 style={{flex:1,minWidth:0}}><ShockGaugeTitle locale={locale} compact/></h2>{!pc&&!locked&&available&&feed.articles.length>0?<Link className={s.more} href="/resolute/news">{en?'Details →':'詳細 →'}</Link>:null}</div>
  {locked?<div className={s.lock}><p>🔒 {en?'The Shock Gauge is included while your alerts access is active.':'衝撃度チェッカーは、アラートの利用期間中に見られます。'}</p><p className={s.sub}>{en?'Renew for another year of the daily Shock Gauge.':'更新すると、また毎朝の衝撃度チェッカーを確認できます。'}</p><Link className={s.primary} href={renewalHref(locale)}>{en?'Renew for one year':'1年分を更新する'}{displayOffer?`　${en?'$'+displayOffer.en:displayOffer.ja.toLocaleString('ja-JP')+'円'}`:''}</Link></div>:<>
   {available&&feed.articles.length>0?(pc?<ShockCards feed={feed} locale={locale} sample={displaySample} member={impactMember}/>:<ShockList feed={feed} locale={locale} sample={displaySample} member={impactMember}/>):<p role="status">{riskStatus(en,status,feed?.state)}</p>}
   {displaySample?<p className={s.notice}>{feed?.date} · {en?'Display sample':'表示見本'}</p>:null}
  </>}
 </div>;
 const rules=<section className={s.sec}><div className={s.lab}>YOUR RULES</div><RuleTiles locale={locale} lockNumbers={lockNumbers}/></section>;
 const alerts=<section className={s.sec}><div className={s.lab}>ALERTS</div><AlertsPanel locale={locale} sampleLabel={displaySample}
  expiry={expiry?`${en?'Access until ':'利用期限 '}${formatDisplay(expiry,en?'en':'ja',{dateStyle:'long'})}`:(en?'Access period not available':'利用期限は未確認です')}
  morning={settings?.settings.morningEnabled??null} saving={saving} onMorning={locked?null:on=>void setMorning(on)}/></section>;
 const foot=<footer className={s.foot}><Link href="/resolute/diagnosis">{en?'Retake the quiz':'診断をやり直す'}</Link></footer>;
 // PC (02_ホーム_PC): TODAY with the date, 今日やること beside the needle meter (same height), the Shock Gauge cards, YOUR RULES,
 // ALERTS and 診断をやり直す. The menu is the shared PC frame's (ToolShell `pc`).
 if(!firstPaint)return <section className={ds.loadingBrand} role="status" aria-live="polite">
  <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>
  <b>RESOLUTE</b><span>{en?"Checking…":"確認中…"}</span></section>;
 if(pc)return <div className={`${s.root} ${s.pcRoot}`}><div className={s.pcWrap}>
  <div className={s.pcToday}><b>TODAY</b><span>{date??'—'}</span></div>
  <div className={`${s.pcTop} ${today?'':s.pcTopSolo}`}>{today}<NeedleCard locale={locale} snapshot={thermometerSnapshot} sample={displaySample}/></div>
  {shock}{rules}{alerts}{foot}
 </div></div>;
 return <div className={s.root}><div className={s.wrap}>
  <div className={`${s.hero} ${ds.starsBand}`}><h1><svg className={s.anc} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4"/><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4"/></svg><span>RESOLUTE</span></h1>
   <div className={s.date}>{date??'—'}</div></div>
  <MarketChartCard locale={locale} snapshot={thermometerSnapshot} sample={displaySample}/>
  <section className={s.sec}><div className={s.lab}>TODAY</div>{today}{shock}</section>
  {rules}{alerts}{foot}
 </div></div>;
}
