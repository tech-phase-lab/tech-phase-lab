import {createReportReader,withReportReader} from './rizel-report-source.mjs';
import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {riskPool} from './risk-store.mjs';
import {createNewsReader,withSourceRetry} from './rizel-news-source.mjs';
import {prepareDailyReview,dailyReviewFailure} from './rizel-daily-review.mjs';
import {createMovesReader} from './risk-moves.mjs';

// Standalone worker, disabled by default. Never start an HTTP listener or timer.
if(process.env.RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED!=='true'){
 console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW',state:'disabled'}));
}else{
 let selectionPool,budgetPool,readFeed,readMoves;
 try{
  const config=resoluteDatabaseConfig(process.env.RESOLUTE_RIZEL_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_rizel_writer')throw Error('SCOPE');
  if(!process.env.RESOLUTE_OPENAI_API_KEY)throw Error('KEY_REQUIRED');
  // A short monitor restart or deploy at 07:01 JST must not crash the job: the read is retried (5 attempts, about 10 minutes).
  readFeed=withSourceRetry(withReportReader(createNewsReader({origin:process.env.RESOLUTE_NEWS_ORIGIN,token:process.env.RESOLUTE_NEWS_READ_TOKEN}),createReportReader({enabled:process.env.RESOLUTE_REPORT_SOURCE_ENABLED==='true',token:process.env.RESOLUTE_REPORT_SOURCE_TOKEN,tickers:process.env.RESOLUTE_REPORT_SOURCE_TICKERS,marketWide:process.env.RESOLUTE_REPORT_MARKET_LANE!=='false'})));
  // Optional read-only thermometer access: without it every story starts as 'waiting for the market' and the react job fills it.
  readMoves=createMovesReader();
  selectionPool=new Pool({...config,max:2});selectionPool.on('error',()=>{});budgetPool=riskPool();
  const result=await prepareDailyReview({enabled:true,selectionPool,budgetPool,apiKey:process.env.RESOLUTE_OPENAI_API_KEY,
   readFeed,publishPool:budgetPool,readMoves});
  console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW',...result,...(readFeed.stats.attempts?{sourceAttempts:readFeed.stats.attempts}:{})}));
 }catch(error){
  const outcome=dailyReviewFailure(error,readFeed?.stats);
  (outcome.exitCode?console.error:console.log)(JSON.stringify(outcome.line));if(outcome.exitCode)process.exitCode=outcome.exitCode;
 }
 finally{await selectionPool?.end();await budgetPool?.end();await readMoves?.end();}
}
