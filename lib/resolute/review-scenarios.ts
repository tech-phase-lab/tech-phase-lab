import {RISK_VISUAL_FIXTURE} from './risk-preview.ts';
import {riskDate,readingStars} from './risk.ts';
import type {RiskFeed,RiskIndex} from './risk.ts';
import {RISK_POLICY} from './risk-policy.ts';
export type ReviewScenario='sample'|'low'|'medium'|'high'|'expired'|'failed'|'preparing'|'live';
/** Presentation overrides, not risk assessments or entitlement mutations. */
export function reviewScenarioFeed(scenario:ReviewScenario,now=new Date()):RiskFeed|null {
 if(scenario==='live')return null;
 if(scenario==='failed')return {state:'failed',date:null,articles:[],quotes:[]};
 if(scenario==='preparing')return {state:'preparing',date:null,articles:[],quotes:[]};
 // Owner, Nov 26: below ★2 is not shown, so the lowest sample is ★2.
 const levels=scenario==='low'?[2,2,2]:scenario==='medium'?[3,3,3]:scenario==='high'?[4,5,4]:null;
 // Sample moves that give each star level under the Shock Gauge rule (display only).
 const sample=(n:number,index:RiskIndex)=>{const bands=RISK_POLICY.stars.bands[index],total=index==='sox'?40:100,size=n<=1?bands[0]/2:bands[n-2]+0.1;
  const measure={changePercent:-Math.round(size*10)/10,multiple:1,same:Math.round(total*0.8),total};return {from:'2026-10-13',nas100:index==='nas100'?measure:null,sox:index==='sox'?measure:null,fearChange:0};};
 return {...RISK_VISUAL_FIXTURE,date:riskDate(now),articles:RISK_VISUAL_FIXTURE.articles.map((a,i)=>{const n=levels?.[i];if(!n||a.market.index==='company')return a;const index=a.market.index,reading=sample(n,index);return {...a,market:{index,session:a.market.session??riskDate(now),reading},stars:readingStars(reading)};}),quotes:[]};
}
