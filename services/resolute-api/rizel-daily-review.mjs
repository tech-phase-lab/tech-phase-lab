import {inspectCandidateFeed,generate,isInDailyWindow,windowHours,FEED_CHECKS} from './risk-job.mjs';
import {riskDate,parseRiskArticle} from '../../lib/resolute/risk.ts';
import {selectArticleForReview} from './rizel-worker.mjs';

/** Pure intake shared by the paid worker and read-only diagnostics. */
export function selectDailyCandidates(feed,now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('INVALID_CLOCK');
 const intake=inspectCandidateFeed(feed,now,{allowDateOnly:true});
 const diagnostics={...intake.diagnostics,outsideDailyWindow:0,duplicateHeadline:0,overDailyLimit:0};
 const seen=new Set();
 const selected=intake.candidates.filter(c=>{
  if(!isInDailyWindow(c.publishedAt,now)){diagnostics.outsideDailyWindow++;return false;}
  if(seen.has(c.fingerprint)){diagnostics.duplicateHeadline++;return false;}
  seen.add(c.fingerprint);return true;
 });
 diagnostics.overDailyLimit=Math.max(0,selected.length-3);selected.splice(3);
 // A quiet day may be claimed only when every configured lane was actually read.
 // Complete = company AND market-wide lanes read, and a full page still reached back past the window start.
 const reached=!diagnostics.reportPossiblyTruncated||(diagnostics.reportOldestPublishedAt!==null&&Date.parse(diagnostics.reportOldestPublishedAt)<=now.getTime()-windowHours(now)*3600000);
 diagnostics.coverageComplete=diagnostics.reportConfigured===true&&diagnostics.reportMarketLane===true&&reached;
 return {selected,diagnostics};
}

/** Trusted worker only, never a browser or customer read path.
 * No scheduler is enabled here. The owner must explicitly enable the worker.
 * Daily claims survive errors: retrying cannot silently repeat paid generation.
 */
export async function prepareDailyReview({enabled=false,readFeed,selectionPool,budgetPool,apiKey,
 publishPool,now=new Date(),summarize=generate,select=selectArticleForReview,fetcher=fetch}) {
 if(!enabled)return {state:'disabled'};
 const jst=new Date(now.getTime()+9*3600000);
 if([0,6].includes(jst.getUTCDay())||jst.getUTCHours()!==7)return {state:'outside-window'};
 const day=riskDate(now);
 const claim=await selectionPool.query(`INSERT INTO public.resolute_rizel_daily_runs(day,state,started_at)
 VALUES($1,'processing',$2) ON CONFLICT DO NOTHING RETURNING day`,[day,now.toISOString()]);
 if(!claim.rows.length)return {state:'already-claimed',day};
 const refs=[],articles=[];let stage='source',diagnostics;
 try{
  const intake=selectDailyCandidates(await readFeed(),now);
  diagnostics=intake.diagnostics;
  const selected=intake.selected;
  stage='storage';
  await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET candidate_count=$2 WHERE day=$1',[day,selected.length]);
  stage='generation';
  for(const candidate of selected){
   const draft=await summarize(candidate,budgetPool,now,fetcher);
   if(!draft)continue;
   const article=parseRiskArticle(draft);
   if(article.id!==candidate.id||article.url!==candidate.url||article.publishedAt!==candidate.publishedAt)throw Error('ARTICLE_MISMATCH');
   // Model classification is not verified evidence for D's factual conditions.
   const result=await select({article,evidence:[],selectionPool,budgetPool,apiKey,now});
   if(result.publication!=='withheld'||result.state!=='selected')throw Error('SELECTION_UNAVAILABLE');
   refs.push({articleId:result.articleId,articleRevision:result.articleRevision});articles.push(article);
   await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET selection_refs=$2 WHERE day=$1',[day,JSON.stringify(refs)]);
  }
  if(selected.length&&!refs.length)throw Error('NO_VERIFIED_OUTPUT');
  stage='readback';
  // Publication stays gated (owner switch + approval variable); this only stores what the owner can preview.
  const stored=articles.length?articles:(diagnostics.coverageComplete&&!selected.length?[]:null);
  if(stored)await saveRiskDay(publishPool??budgetPool,day,stored,now);
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='ready',finished_at=$2 WHERE day=$1",[day,new Date().toISOString()]);
  const saved=(await selectionPool.query('SELECT state,candidate_count,selection_refs,publication FROM public.resolute_rizel_daily_runs WHERE day=$1',[day])).rows[0];
  if(saved?.state!=='ready'||saved.candidate_count!==selected.length||saved.publication!=='withheld'||!Array.isArray(saved.selection_refs)||saved.selection_refs.length!==refs.length||refs.some((ref,i)=>saved.selection_refs[i]?.articleId!==ref.articleId||saved.selection_refs[i]?.articleRevision!==ref.articleRevision))throw Error('READBACK_MISMATCH');
  return {state:refs.length?'ready':'no-candidates',day,count:refs.length,publication:'withheld',storageVerified:true,diagnostics};
 }catch(cause){
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='failed',finished_at=$2 WHERE day=$1",[day,now.toISOString()]);
  // A real failure is recorded so the app can say "couldn't update" (never "quiet day").
  await saveRiskDay(publishPool??budgetPool,day,null,now).catch(()=>{});
  const error=new Error('PRIVATE_DAILY_REVIEW_FAILED');error.stage=stage;error.diagnostics=diagnostics;
  // Only fixed codes and counts travel on; the cause itself (which may hold a URL or body) is dropped.
  error.code=safeErrorCode(cause);if(FEED_CHECKS.includes(cause?.check))error.check=cause.check;
  if(cause?.counts)error.counts=safeCounts(cause.counts);if(Number.isSafeInteger(cause?.limit))error.limit=cause.limit;
  throw error;
 }
}

/** The worker's log line and exit code for a failed run. When the source read failed only after every retry ran out (the
 * research monitor restarting or deploying at 07:01 JST), the day is already recorded as failed ("couldn't update", never a quiet
 * day) and the job exits 0 instead of crashing; any other failure still exits 1. ``stats`` comes from withSourceRetry. */
export function dailyReviewFailure(error,stats){
 const attempts=stats?.attempts?{sourceAttempts:stats.attempts}:{};
 const code=SAFE_ERROR_CODES.has(error?.code)?error.code:safeErrorCode(error);
 if(error?.stage==='source'&&stats?.exhausted===true)return {exitCode:0,line:{event:'RIZEL_DAILY_REVIEW',state:'source-unavailable-after-retries',...attempts}};
 return {exitCode:1,line:{event:'RIZEL_DAILY_REVIEW_FAILED',stage:['source','storage','generation','readback'].includes(error?.stage)?error.stage:'configuration',
  error:code,...(FEED_CHECKS.includes(error?.check)?{check:error.check}:{}),...(error?.counts?{counts:safeCounts(error.counts)}:{}),
  ...(Number.isSafeInteger(error?.limit)?{limit:error.limit}:{}),diagnostics:error?.diagnostics,...attempts}};
}

/** Error codes this worker and its readers throw on purpose. Anything else is logged as UNLISTED (with a built-in error
 * class name at most), because a foreign message can carry a URL, token or response text. */
export const SAFE_ERROR_CODES=new Set(['SOURCE_UNAVAILABLE','SOURCE_LIMIT','SOURCE_CONFIG','REPORT_SOURCE_UNAVAILABLE','REPORT_SOURCE_CONFIG',
 'INVALID_CLOCK','INVALID_INPUT','ARTICLE_MISMATCH','SELECTION_UNAVAILABLE','NO_VERIFIED_OUTPUT','READBACK_MISMATCH','MODEL_NOT_CONFIGURED',
 'MODEL_UNAVAILABLE','MODEL_INCOMPLETE','AI_BUDGET_NOT_CONFIGURED','AI_REQUEST_OUTSIDE_BUDGET','BUDGET_LIMIT','RIZEL_AI_FAILED',
 'RIZEL_AI_INCOMPLETE','RIZEL_AI_NOT_ENABLED','PRIVATE_BANK_INCOMPLETE','SCOPE','KEY_REQUIRED','READ_ONLY_REQUIRED']);
const BUILTIN_ERRORS=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','AbortError','TimeoutError']);
export function safeErrorCode(error){
 if(SAFE_ERROR_CODES.has(error?.message))return error.message;
 const name=typeof error?.name==='string'&&BUILTIN_ERRORS.has(error.name)?error.name:'unknown';
 return `UNLISTED:${name}`;
}
const COUNT_KEYS=['generalEnabled','generalCount','officialCount','reportCount','reportReturned','reportMarketLane'];
function safeCounts(counts){
 const out={};
 for(const key of COUNT_KEYS){const v=counts?.[key];out[key]=typeof v==='boolean'||Number.isSafeInteger(v)?v:null;}
 return out;
}

/** articles=null records a failed day; an empty array is a verified quiet day. Never overwrites a ready day. */
export async function saveRiskDay(pool,day,articles,now=new Date()){
 if(!pool)return;
 const state=articles===null?'failed':'ready';
 await pool.query(`INSERT INTO resolute.risk_days(day,state,articles,updated_at) VALUES($1,$2,$3,$4)
  ON CONFLICT(day) DO UPDATE SET state=EXCLUDED.state,articles=EXCLUDED.articles,updated_at=EXCLUDED.updated_at WHERE resolute.risk_days.state<>'ready'`,[day,state,JSON.stringify(articles??[]),now.toISOString()]);
}
