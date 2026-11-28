import {createReportReader,withReportReader,reportMaxPages} from './rizel-report-source.mjs';
import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {riskPool} from './risk-store.mjs';
import {createNewsReader,withSourceRetry} from './rizel-news-source.mjs';
import {prepareDailyReview,dailyReviewFailure,reselectStoredDay,selectDailyCandidates,previewSelection,readStart} from './rizel-daily-review.mjs';

import {createMovesReader,withThermometerFallback,withSessionMovesFallback} from './risk-moves.mjs';
import {judgeDay} from './shock-judge.mjs';
import {sendOwnerShockMail} from './shock-owner-mail.mjs';
import {createClerkClient} from '@clerk/backend';
import {runCandidates,publishPicks,sendCandidatesMail} from './shock-candidates.mjs';
import {isCandidateRun} from '../../lib/resolute/shock-picks.ts';
import {isPublishRunHour} from '../../lib/resolute/risk.ts';
// The owner pick (owner, Nov 27) replaces the automatic selection once RESOLUTE_SHOCK_OWNER_PICK=true (needs migration 030).
// `node rizel-daily-review-cli.mjs candidates` is the candidate run (06:00 / 06:30 JST); without an argument, the publish run (08:20 JST).
const ownerPick=process.env.RESOLUTE_SHOCK_OWNER_PICK==='true',mode=process.argv[2]??'publish';
const mailClerk=()=>{const secretKey=process.env.RESOLUTE_MAIL_CLERK_SECRET_KEY;return secretKey?createClerkClient({secretKey}):null;};
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
   const now=new Date(),feed=await readFeed({since:readStart(now)});
   let intake=selectDailyCandidates(feed,now);const moves=readMoves&&intake.sessions.length?await readMoves(intake.sessions):null;
   if(moves)intake=selectDailyCandidates(feed,now,{moves});
   console.log(JSON.stringify({event:'RIZEL_DAILY_REVIEW_PREVIEW',...previewSelection(intake,moves)}));
  }else if(mode==='candidates'){
   const now=new Date();
   if(!ownerPick)console.log(JSON.stringify({event:'RIZEL_SHOCK_CANDIDATES',state:'owner-pick-off'}));
   else if(!isCandidateRun(now))console.log(JSON.stringify({event:'RIZEL_SHOCK_CANDIDATES',state:'not-candidate-time'}));
   // The latest closed session's moves (owner, Nov 28): the snapshot is written at 07:30 JST, after this run, so a session it lacks is
   // measured here through the Twelve Data lease (background tier; TWELVE_DATA_API_KEY on this service). Nothing is stored.
   else{const r=await runCandidates({pool:budgetPool,readFeed,readMoves:withSessionMovesFallback(readMoves,process.env.TWELVE_DATA_API_KEY),now,mail:x=>sendCandidatesMail({...x,clerk:mailClerk()})});
    console.log(JSON.stringify({event:'RIZEL_SHOCK_CANDIDATES',...r}));}
  }else if(ownerPick){
   const now=new Date();
   if(!isPublishRunHour(now))console.log(JSON.stringify({event:'RIZEL_SHOCK_PUBLISH',state:'outside-window'}));
   else{const result=await publishPicks({pool:budgetPool,readFeed,readMoves:withSessionMovesFallback(readMoves,process.env.TWELVE_DATA_API_KEY),now});
    console.log(JSON.stringify({event:'RIZEL_SHOCK_PUBLISH',...result}));
    if(result.state==='ready'||result.state==='no-candidates'){
     try{const mail=await sendOwnerShockMail({pool:budgetPool,day:result.day,clerk:mailClerk()});console.log(JSON.stringify({event:'RIZEL_SHOCK_OWNER_MAIL',day:result.day,...mail}));}
     catch{console.error(JSON.stringify({event:'RIZEL_SHOCK_OWNER_MAIL',day:result.day,state:'failed'}));}
    }}
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
   try{const mail=await sendOwnerShockMail({pool:budgetPool,day:result.day,withheld:result.withheldStories??[],clerk:mailClerk()});
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
