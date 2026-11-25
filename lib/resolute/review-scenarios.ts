import {RISK_VISUAL_FIXTURE} from './risk-preview.ts';
import {riskDate,starsFromShock} from './risk.ts';
import type {RiskFeed,RiskIndex} from './risk.ts';
import {RISK_POLICY} from './risk-policy.ts';
export type ReviewScenario='sample'|'low'|'medium'|'high'|'expired'|'failed'|'preparing'|'live';
/** Presentation overrides, not risk assessments or entitlement mutations. */
export function reviewScenarioFeed(scenario:ReviewScenario,now=new Date()):RiskFeed|null {
 if(scenario==='live')return null;
 if(scenario==='failed')return {state:'failed',date:null,articles:[],quotes:[]};
 if(scenario==='preparing')return {state:'preparing',date:null,articles:[],quotes:[]};
 const levels=scenario==='low'?[1,2,1]:scenario==='medium'?[3,3,3]:scenario==='high'?[4,5,4]:null;
 // Sample moves that give each star level under the Shock Gauge rule (display only).
 const sample=(n:number,index:RiskIndex)=>{const l=RISK_POLICY.stars.levels.find(x=>x.stars===n),total=index==='sox'?40:100;
  const shock={multiple:l?.multiple??0.5,same:Math.ceil((l?.breadth??50)*total/100),total,fearChange:l?.fear??0};return {shock,changePercent:-Math.round(shock.multiple*15)/10};};
 return {...RISK_VISUAL_FIXTURE,date:riskDate(now),articles:RISK_VISUAL_FIXTURE.articles.map((a,i)=>{const n=levels?.[i];if(!n||a.market.index==='company')return a;const index=a.market.index,{shock,changePercent}=sample(n,index);return {...a,market:{...a.market,index,session:a.market.session??riskDate(now),changePercent,shock},stars:starsFromShock(shock)};}),quotes:[]};
}
