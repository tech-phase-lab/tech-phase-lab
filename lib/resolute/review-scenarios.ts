import {RISK_VISUAL_FIXTURE} from './risk-preview.ts';
import {riskDate} from './risk.ts';
import type {RiskFeed} from './risk.ts';
export type ReviewScenario='sample'|'low'|'medium'|'high'|'expired'|'failed'|'live';
/** Presentation overrides, not risk assessments or entitlement mutations. */
export function reviewScenarioFeed(scenario:ReviewScenario,now=new Date()):RiskFeed|null {
 if(scenario==='live')return null;
 if(scenario==='failed')return {state:'failed',date:null,articles:[],quotes:[]};
 const levels=scenario==='low'?[1,2,1]:scenario==='medium'?[3,3,3]:scenario==='high'?[4,5,4]:null;
 return {...RISK_VISUAL_FIXTURE,date:riskDate(now),articles:RISK_VISUAL_FIXTURE.articles.map((a,i)=>({...a,stars:levels?.[i]??a.stars})),quotes:[]};
}
