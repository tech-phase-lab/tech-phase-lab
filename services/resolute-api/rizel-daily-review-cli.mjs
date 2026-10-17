import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {riskPool,boundedJSON} from './risk-store.mjs';
import {prepareDailyReview} from './rizel-daily-review.mjs';

// Standalone worker, disabled by default. Never start an HTTP listener or timer.
if(process.env.RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED!=='true'){
 console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW',state:'disabled'}));
}else{
 let selectionPool,budgetPool;
 try{
  const config=resoluteDatabaseConfig(process.env.RESOLUTE_RIZEL_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_rizel_writer')throw Error('SCOPE');
  if(!process.env.RESOLUTE_OPENAI_API_KEY)throw Error('KEY_REQUIRED');
  const origin=new URL(process.env.RESOLUTE_NEWS_ORIGIN);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('SOURCE_CONFIG');
  origin.pathname='/api/research/news';
  selectionPool=new Pool({...config,max:2});selectionPool.on('error',()=>{});budgetPool=riskPool();
  const result=await prepareDailyReview({enabled:true,selectionPool,budgetPool,apiKey:process.env.RESOLUTE_OPENAI_API_KEY,
   readFeed:async()=>{const r=await fetch(origin,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('SOURCE_UNAVAILABLE');return boundedJSON(r,500000);}});
  console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW',...result}));
 }catch{console.error(JSON.stringify({event:'RIZEL_DAILY_REVIEW_FAILED'}));process.exitCode=1;}
 finally{await selectionPool?.end();await budgetPool?.end();}
}
