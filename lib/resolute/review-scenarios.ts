import {RISK_VISUAL_FIXTURE} from './risk-preview.ts';
import {riskDate,starsFromMove} from './risk.ts';
import type {RiskFeed} from './risk.ts';
export type ReviewScenario='sample'|'low'|'medium'|'high'|'expired'|'failed'|'preparing'|'live';
/** Presentation overrides, not risk assessments or entitlement mutations. */
export function reviewScenarioFeed(scenario:ReviewScenario,now=new Date()):RiskFeed|null {
 if(scenario==='live')return null;
 if(scenario==='failed')return {state:'failed',date:null,articles:[],quotes:[]};
 if(scenario==='preparing')return {state:'preparing',date:null,articles:[],quotes:[]};
 const levels=scenario==='low'?[1,2,1]:scenario==='medium'?[3,3,3]:scenario==='high'?[4,5,4]:null;
 // Sample moves that give each star level under the Shock Gauge rule (display only).
 const move:Record<number,number>={1:-0.6,2:-1.4,3:-2.5,4:-3.2,5:-5.6};
 return {...RISK_VISUAL_FIXTURE,date:riskDate(now),articles:RISK_VISUAL_FIXTURE.articles.map((a,i)=>{const n=levels?.[i];if(!n)return a;const changePercent=move[n];return {...a,market:{...a.market,session:a.market.session??riskDate(now),changePercent},stars:starsFromMove(changePercent)};}),quotes:[]};
}
