import {createReportReader,withReportReader,reportMaxPages} from './rizel-report-source.mjs';
import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {riskPool} from './risk-store.mjs';
import {createNewsReader,withSourceRetry} from './rizel-news-source.mjs';
import {prepareDailyReview,dailyReviewFailure,reselectStoredDay,selectDailyCandidates,previewSelection} from './rizel-daily-review.mjs';
import {windowHours} from './risk-job.mjs';
import {createMovesReader,withThermometerFallback} from './risk-moves.mjs';
import {judgeDay} from './shock-judge.mjs';
import {sendOwnerShockMail} from './shock-owner-mail.mjs';
import {createClerkClient} from '@clerk/backend';
// The day's AI judgement of the stars (owner, Nov 26) is on unless RESOLUTE_SHOCK_AI_JUDGE=false; it falls back to the numeric rule.
const judge=process.env.RESOLUTE_SHOCK_AI_JUDGE==='false'?null:judgeDay;

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
  readFeed=withSourceRetry(withReportReader(createNewsReader({origin:process.env.RESOLUTE_NEWS_ORIGIN,token:process.env.RESOLUTE_NEWS_READ_TOKEN}),createReportReader({enabled:process.env.RESOLUTE_REPORT_SOURCE_ENABLED==='true',token:process.env.RESOLUTE_REPORT_SOURCE_TOKEN,tickers:process.env.RESOLUTE_REPORT_SOURCE_TICKERS,marketWide:process.env.RESOLUTE_REPORT_MARKET_LANE!=='false',maxPages:reportMaxPages()})));
  // Optional read-only thermometer access: without it every story starts as 'waiting for the market' and the react job fills it.
  readMoves=createMovesReader();
  selectionPool=new Pool({...config,max:2});selectionPool.on('error',()=>{});budgetPool=riskPool();
  if(process.env.RIZEL_DAILY_REVIEW_DRY_RUN==='true'){
   // Read-only preview (owner check): what today's selection picks under the current rules. No model call, no writes.
   const now=new Date(),feed=await readFeed({since:now.getTime()-windowHours(now)*3600000});
   let intake=selectDailyCandidates(feed,now);const moves=readMoves&&intake.sessions.length?await readMoves(intake.sessions):null;
   if(moves)intake=selectDailyCandidates(feed,now,{moves});
   console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW_PREVIEW',...previewSelection(intake,moves)}));
  }else{
  // One-off (owner, Nov 25): re-select today's stored day under the current rules, once (reselectStoredDay).
  try{const r=await reselectStoredDay({publishPool:budgetPool,selectionPool,budgetPool,apiKey:process.env.RESOLUTE_OPENAI_API_KEY,readFeed,readMoves:process.env.RESOLUTE_SHOCK_GAUGE_RESELECT_DAY?withThermometerFallback(readMoves,process.env.TWELVE_DATA_API_KEY):readMoves});
   if(r.state!=='reselect-off')console.log(JSON.stringify({event:'RIZEL_SHOCK_GAUGE_RESELECT',...r}));}
  catch(error){const outcome=dailyReviewFailure(error,readFeed?.stats);console.error(JSON.stringify({...outcome.line,event:'RIZEL_SHOCK_GAUGE_RESELECT_FAILED'}));}
  const result=await prepareDailyReview({enabled:true,selectionPool,budgetPool,apiKey:process.env.RESOLUTE_OPENAI_API_KEY,
   readFeed,publishPool:budgetPool,readMoves,judge});
  console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW',...result,...(readFeed.stats.attempts?{sourceAttempts:readFeed.stats.attempts}:{})}));
  // The owner's morning mail (off unless RESOLUTE_SHOCK_OWNER_MAIL_ENABLED=true). Only a fixed state is logged, never the address.
  if(['ready','none-today','no-candidates'].includes(result.state)){
   try{const secretKey=process.env.RESOLUTE_MAIL_CLERK_SECRET_KEY;
    const mail=await sendOwnerShockMail({pool:budgetPool,day:result.day,clerk:secretKey?createClerkClient({secretKey}):null});
    console.log(JSON.stringify({event:'RIZEL_SHOCK_OWNER_MAIL',day:result.day,...mail}));}
   catch{console.error(JSON.stringify({event:'RIZEL_SHOCK_OWNER_MAIL',day:result.day,state:'failed'}));}
  }
  }
 }catch(error){
  const outcome=dailyReviewFailure(error,readFeed?.stats);
  (outcome.exitCode?console.error:console.log)(JSON.stringify(outcome.line));if(outcome.exitCode)process.exitCode=outcome.exitCode;
 }
 finally{await selectionPool?.end();await budgetPool?.end();await readMoves?.end();}
}
