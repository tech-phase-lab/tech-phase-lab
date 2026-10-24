import {rizelPool,readApprovedBank} from './rizel-review-store.mjs';
import {riskPool} from './risk-store.mjs';
import {createNewsReader} from './rizel-news-source.mjs';

// Deployment preflight only: no model call, daily claim, approval or publication.
let selectionPool,budgetPool,stage='configuration';
try{
 if(!process.env.RESOLUTE_OPENAI_API_KEY)throw Error('KEY_REQUIRED');
 const readFeed=createNewsReader({origin:process.env.RESOLUTE_NEWS_ORIGIN,token:process.env.RESOLUTE_NEWS_READ_TOKEN});
 selectionPool=rizelPool();budgetPool=riskPool();
 stage='private-storage';
 if((await readApprovedBank(selectionPool)).length!==90)throw Error('BANK_INCOMPLETE');
 await selectionPool.query('SELECT day FROM public.resolute_rizel_daily_runs LIMIT 0');
 await budgetPool.query('SELECT reserved_usd FROM resolute.risk_budget LIMIT 0');
 stage='news-source';
 await readFeed();
 console.log(JSON.stringify({event:'RIZEL_DAILY_PREFLIGHT',state:'ready',approvedPairs:90,publication:'withheld',aiCalls:0,writes:0}));
}catch{
 console.error(JSON.stringify({event:'RIZEL_DAILY_PREFLIGHT',state:'failed',stage}));process.exitCode=1;
}finally{await selectionPool?.end();await budgetPool?.end();}
