import {inspectCandidateFeed,generate,isInDailyWindow,windowHours,FEED_CHECKS as INSPECT_CHECKS,reactArticles,fillMarketReactions} from './risk-job.mjs';
import {REPORT_CHECKS} from './rizel-report-source.mjs';
const FEED_CHECKS=[...INSPECT_CHECKS,...REPORT_CHECKS];
import {riskDate,parseRiskArticle,parseRiskMarket,parseRiskCause,causeStars,isDailyRunHour,dailyRunStart,marketStars,readingStars} from '../../lib/resolute/risk.ts';
import {applyMarketReaction} from '../../lib/resolute/risk-market.ts';
import {RISK_POLICY} from '../../lib/resolute/risk-policy.ts';
import {storyIndex,firstCloseAfter,newsInstant} from '../../lib/resolute/risk-market.ts';
import {storyScope,isBarePriceMove,companyKey,titleSimilarity,NEAR_DUPLICATE} from '../../lib/resolute/risk-scope.ts';
import {selectArticleForReview} from './rizel-worker.mjs';

/** The first U.S. close after a candidate and its related TP index (the same rule that later fills the stars).
 * Single-company news has no index and no session: it never gets stars. */
export function candidateSession(c){const index=storyIndex(c.title);return {session:index==='company'?null:firstCloseAfter(newsInstant(c.publishedAt)),index};}
/** True when that close's shock is already measured in the thermometer snapshots, so the story gets its stars in this run. */
export function hasKnownMove(c,moves){const {session,index}=candidateSession(c);const m=session?moves?.[session]?.[index]:null;return !!m&&typeof m.changePercent==='number'&&Number.isFinite(m.changePercent)&&m.typicalPercent>0;}
/** Stories a day and model attempts a day: RISK_POLICY defaults, lowered or raised (within the policy's hard caps) by
 * RESOLUTE_RIZEL_DAILY_STORIES and RESOLUTE_RIZEL_DAILY_ATTEMPTS. Anything malformed falls back to the default. */
export function dailyLimits(env=process.env){
 const pick=(raw,fallback,max)=>{const n=typeof raw==='string'&&/^\d{1,2}$/.test(raw.trim())?Number(raw.trim()):NaN;return n>=1&&n<=max?n:fallback;};
 const stories=pick(env?.RESOLUTE_RIZEL_DAILY_STORIES,RISK_POLICY.dailyStories,RISK_POLICY.maxDailyStories);
 return {stories,attempts:Math.max(stories,pick(env?.RESOLUTE_RIZEL_DAILY_ATTEMPTS,RISK_POLICY.dailyAttempts,RISK_POLICY.maxDailyAttempts))};
}
// Opinion, ranking and promotional headlines: the model withholds these, so they go to the back of the queue (never dropped).
const OPINION=/\b(?:stocks? to (?:buy|sell|watch|own)|buy (?:now|the dip)|should you|is it (?:time|too late)|(?:top|best) (?:\d+ )?(?:ai |tech |chip |semiconductor |growth )?stocks?|\d+ (?:stocks|reasons|things|ways)|millionaire|predictions?|could (?:soar|double|triple)|here's (?:why|what|how)|what to (?:know|expect|watch)|my (?:top|favorite))\b/i;
// Price-move recaps ("X fell 4%") say less than the news that moved the price: ranked below it (Nov 25; they had a +2 bonus).
const PRICE_MOVE=/\b(?:fell|falls?|drops?|dropped|slides?|slid|sinks?|sank|tumbl\w+|plung\w+|slump\w*|sell-?off|down|lower|declin\w+)\b[^.]{0,40}?\d+(?:\.\d+)?%|\d+(?:\.\d+)?%[^.]{0,30}?\b(?:drop|decline|fall|slide|lower|loss)/i;
const isOpinion=title=>OPINION.test(title)||/\?\s*$/.test(title);
/** Ranking hint (Nov 24): how likely a story is the day's market-moving downside news. Never a reason to publish. */
export function candidateScore(c){
 let score=0;
 if(c.headlineDownside)score+=2;
 if(c.providerNegative)score+=2;
 if(PRICE_MOVE.test(c.title))score-=1;
 if(c.source==='official'||c.rostered||c.tickers?.length)score+=1;
 if(OPINION.test(c.title)||/\?\s*$/.test(c.title))score-=4;
 if(c.video)score-=3;
 return score;
}
/** Scope order (owner, Nov 25): market-wide news first, then the chip sector, and single-company news only to fill what is left. */
const SCOPE_ORDER={market:0,semis:1,company:2};
/** What one story occupies: its index and U.S. close (at most RISK_POLICY.perIndexSession stories show the same move), or, for
 * single-company news, that company (at most one story per company a day). */
export function slotKey(c){const {session,index}=candidateSession(c);return index==='company'?`company:${companyKey(c)}`:`${index}:${session??'unknown'}`;}
/** True when `c` would repeat a story already taken: the same slot (index and close, or company), or a near-duplicate headline. */
export function repeatsTaken(c,taken){
 const key=slotKey(c),same=taken.filter(t=>slotKey(t)===key).length;
 return (key.startsWith('company:')?same>=1:same>=RISK_POLICY.perIndexSession)||taken.some(t=>titleSimilarity(t.title,c.title)>=NEAR_DUPLICATE);
}
/** Pure intake shared by the paid worker and read-only diagnostics.
 * Every in-window story gets a scope from its headline (lib/resolute/risk-scope.ts). Bare price-move recaps about one company
 * ("Nvidia falls 5.6% in premarket", no cause) are dropped. The rest are ranked: scope (market, semis, company), then stories whose
 * U.S. close is already known (with `moves`), then candidateScore, then the newest. `selected` takes up to `limits.stories` of them
 * in that order, skipping any that repeats one already taken (repeatsTaken); `reserve` keeps the others in order, tried only when
 * a selected one fails the checks (the worker re-applies repeatsTaken and stops at `limits.attempts` model calls). */
export function selectDailyCandidates(feed,now=new Date(),{moves=null,limits=dailyLimits()}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('INVALID_CLOCK');
 const intake=inspectCandidateFeed(feed,now,{allowDateOnly:true});
 const diagnostics={...intake.diagnostics,outsideDailyWindow:0,duplicateHeadline:0,barePriceMove:0,repeated:0,overDailyLimit:0,scopes:{market:0,semis:0,company:0}};
 const seen=new Set();
 const ranked=intake.candidates.filter(c=>{
  if(!isInDailyWindow(c.publishedAt,now)){diagnostics.outsideDailyWindow++;return false;}
  if(seen.has(c.fingerprint)){diagnostics.duplicateHeadline++;return false;}
  seen.add(c.fingerprint);
  const scope=storyScope(c.title);
  if(scope==='company'&&isBarePriceMove(c.title)){diagnostics.barePriceMove++;return false;}
  diagnostics.scopes[scope]++;return true;
 });
 // Every in-window candidate's first close, so the known-move ordering can reach past the newest few stories (Nov 23 fix:
 // reading only the newest five, all from the weekend, left Friday's stories unordered and every pick was weekend commentary).
 const sessions=[...new Set(ranked.map(c=>candidateSession(c).session).filter(Boolean))];
 const known=new Set(moves?ranked.filter(c=>hasKnownMove(c,moves)):[]);if(moves)diagnostics.knownMove=known.size;
 // Opinion / ranking pieces go behind every scope (they are withheld by the model, so they must not take a market-wide slot).
 const scores=new Map(ranked.map(c=>[c,candidateScore(c)])),order=new Map(ranked.map(c=>[c,isOpinion(c.title)?3:SCOPE_ORDER[storyScope(c.title)]]));
 ranked.sort((a,b)=>(order.get(a)-order.get(b))||(known.has(b)-known.has(a))||(scores.get(b)-scores.get(a))||b.publishedAt.localeCompare(a.publishedAt));
 const selected=[],reserve=[];
 for(const c of ranked){
  if(selected.length<limits.stories&&!repeatsTaken(c,selected))selected.push(c);
  else{if(repeatsTaken(c,selected))diagnostics.repeated++;if(reserve.length<RESERVE_MAX)reserve.push(c);}
 }
 diagnostics.overDailyLimit=Math.max(0,ranked.length-selected.length);
 // A quiet day may be claimed only when every configured lane was actually read.
 // Complete = company AND market-wide lanes read, and a full page still reached back past the window start.
 const reached=!diagnostics.reportPossiblyTruncated||(diagnostics.reportOldestPublishedAt!==null&&Date.parse(diagnostics.reportOldestPublishedAt)<=now.getTime()-windowHours(now)*3600000);
 diagnostics.coverageComplete=diagnostics.reportConfigured===true&&diagnostics.reportMarketLane===true&&reached;
 return {selected,reserve,sessions,diagnostics};
}
const RESERVE_MAX=60;

/** Trusted worker only, never a browser or customer read path.
 * No scheduler is enabled here. The owner must explicitly enable the worker.
 * Daily claims survive errors: retrying cannot silently repeat paid generation.
 */
export async function prepareDailyReview({enabled=false,readFeed,selectionPool,budgetPool,apiKey,
 publishPool,now=new Date(),summarize=generate,select=selectArticleForReview,fetcher=fetch,readMoves=null,limits=dailyLimits(),replace=null}) {
 if(!enabled)return {state:'disabled'};
 if(!isDailyRunHour(now))return {state:'outside-window'};
 const day=riskDate(now);
 // `replace` (the one-off re-selection only, reselectStoredDay): the day's finished run is claimed again, and the stored day is
 // replaced only by a run that keeps at least one story, compare-and-set against the stored articles it was asked to replace.
 const claim=replace?await selectionPool.query(`UPDATE public.resolute_rizel_daily_runs SET state='processing',started_at=$2,finished_at=NULL,candidate_count=0,selection_refs='[]'
 WHERE day=$1 AND state<>'processing' RETURNING day`,[day,now.toISOString()]):await selectionPool.query(`INSERT INTO public.resolute_rizel_daily_runs(day,state,started_at)
 VALUES($1,'processing',$2) ON CONFLICT DO NOTHING RETURNING day`,[day,now.toISOString()]);
 if(!claim.rows.length)return {state:'already-claimed',day};
 const refs=[],articles=[];let stage='source',diagnostics;
 try{
  // The report reader pages back to the window start (Nov 24: one page reached only about 4 of the 30 hours).
  const feed=await readFeed({since:now.getTime()-windowHours(now)*3600000});
  let intake=selectDailyCandidates(feed,now,{limits});
  // Both steps below only improve the day (stars on earlier stories, starred stories first); a failure in them never
  // blocks it or changes what is checked. Stories still waiting from earlier days get their stars once their close is known.
  let market=null;
  if(readMoves){
   market={};
   // The one-off re-selection leaves stored days alone: it replaces only its own day, compare-and-set against what it read.
   try{if(!replace&&(publishPool??budgetPool)){const f=await fillMarketReactions(publishPool??budgetPool,readMoves,now);market.earlierDaysFilled=f.updated;market.earlierStoriesWaiting=f.waiting;}}catch{market.earlierDays='failed';}
   try{const sessions=intake.sessions;
    if(sessions.length)intake=selectDailyCandidates(feed,now,{moves:await readMoves(sessions),limits});}catch{market.ordering='failed';}
  }
  diagnostics={...intake.diagnostics,...(market?{market}:{})};
  const selected=intake.selected,reserve=[...intake.reserve];
  stage='storage';
  await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET candidate_count=$2 WHERE day=$1',[day,selected.length]);
  stage='generation';
  const quotes=(publishPool??budgetPool)&&readMoves?((await (publishPool??budgetPool).query('SELECT value FROM resolute.risk_quotes')).rows??[]).map(r=>r.value).filter(q=>q?.approved===true):[];
  // A candidate that fails the checks is replaced by the next one in reserve (bounded: limits.attempts model calls at most).
  // The replacement is the best-ranked reserve story that does not repeat a story already kept or still queued (repeatsTaken).
  const queue=[...selected],kept=[];let attempts=0;const withheld=[];
  const refill=()=>{const i=reserve.findIndex(c=>!repeatsTaken(c,[...kept,...queue]));if(i>=0)queue.push(reserve.splice(i,1)[0]);};
  while(queue.length&&articles.length<limits.stories&&attempts<limits.attempts){
   const candidate=queue.shift();attempts++;
   const why={};
   const draft=await summarize(candidate,budgetPool,now,fetcher,{why});
   if(!draft){withheld.push(why.reason??'unknown');refill();continue;}
   kept.push(candidate);
   const parsed=parseRiskArticle(draft);
   if(parsed.id!==candidate.id||parsed.url!==candidate.url||parsed.publishedAt!==candidate.publishedAt)throw Error('ARTICLE_MISMATCH');
   // Shock Gauge: stars only from the related TP index's move at the first U.S. close after the news (may still be waiting).
   const [article]=(await reactArticles([parsed],readMoves,quotes,day)).map(parseRiskArticle);
   // A story still waiting for the market has no stars yet, so no RIZEL line is chosen for it now.
   if(article.stars===null){articles.push(article);continue;}
   // Model classification is not verified evidence for D's factual conditions.
   const result=await select({article,evidence:[],selectionPool,budgetPool,apiKey,now});
   // 'no-relevant-conclusion' (e.g. every fitting line awaits re-approval) keeps the story without a RIZEL line.
   if(result.publication!=='withheld'||!['selected','no-relevant-conclusion'].includes(result.state))throw Error('SELECTION_UNAVAILABLE');
   refs.push({articleId:result.articleId,articleRevision:result.articleRevision});articles.push(article);
   await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET selection_refs=$2 WHERE day=$1',[day,JSON.stringify(refs)]);
  }
  // Nothing qualified today (owner, Nov 23): when the model judged every story it was given to be outside the brief
  // ('not-publishable'), the day is a normal quiet day (「今日は、気にするニュースはありません」), saved as ready and exit 0.
  // A story that did qualify but failed the copy checks (new number, amount, banned wording) is still a failed day.
  const noneQualified=selected.length>0&&!articles.length&&withheld.length===attempts&&withheld.every(r=>r==='not-publishable');
  if(selected.length&&!articles.length&&!noneQualified)throw Error('NO_VERIFIED_OUTPUT');
  diagnostics.attempts=attempts;if(withheld.length)diagnostics.withheld=countReasons(withheld);
  stage='readback';
  // Publication stays gated (owner switch + approval variable); this only stores what the owner can preview.
  const stored=articles.length?articles:(noneQualified||diagnostics.coverageComplete&&!selected.length?[]:null);
  if(replace){if(!articles.length)throw Error('NO_VERIFIED_OUTPUT');
   const r=await (publishPool??budgetPool).query("UPDATE resolute.risk_days SET state='ready',articles=$2::jsonb,updated_at=$3 WHERE day=$1::date AND articles=$4::jsonb RETURNING day",[day,JSON.stringify(articles),replace.at.toISOString(),JSON.stringify(replace.articles)]);
   if(!r.rows.length)throw Error('READBACK_MISMATCH');}
  else if(stored)await saveRiskDay(publishPool??budgetPool,day,stored,now);
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='ready',finished_at=$2 WHERE day=$1",[day,new Date().toISOString()]);
  const saved=(await selectionPool.query('SELECT state,candidate_count,selection_refs,publication FROM public.resolute_rizel_daily_runs WHERE day=$1',[day])).rows[0];
  if(saved?.state!=='ready'||saved.candidate_count!==selected.length||saved.publication!=='withheld'||!Array.isArray(saved.selection_refs)||saved.selection_refs.length!==refs.length||refs.some((ref,i)=>saved.selection_refs[i]?.articleId!==ref.articleId||saved.selection_refs[i]?.articleRevision!==ref.articleRevision))throw Error('READBACK_MISMATCH');
  return {state:articles.length?'ready':noneQualified?'none-today':'no-candidates',day,count:articles.length,rizelSelections:refs.length,waitingForMarket:articles.filter(a=>a.stars===null&&a.market.index!=='company').length,companyNews:articles.filter(a=>a.market.index==='company').length,publication:'withheld',storageVerified:true,diagnostics};
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

const WITHHELD_REASONS=['not-publishable','new-number','japanese-amount','shape','banned-wording'];
/** Counts per fixed reason code (never text), for the run's log line. */
function countReasons(reasons){const out={};for(const r of reasons){const k=WITHHELD_REASONS.includes(r)?r:'unknown';out[k]=(out[k]??0)+1;}return out;}

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

/** True when a stored day breaks the current rules (Nov 25): a stored star that the published thresholds no longer give, a story
 * measured on the wrong scope's index is not detectable from the copy, so this checks stars and repeats: two stories on the same
 * index and close, or two on the same company. A day saved by the current rules never matches, so the one-off runs once. */
export function breaksCurrentRules(articles){
 if(!Array.isArray(articles)||!articles.length)return false;
 const slots=new Set();
 for(const a of articles){
  const m=a?.market;if(!m||typeof m!=='object')return false;
  let expected=null;try{expected=causeStars(marketStars(parseRiskMarket(m)),parseRiskCause(a.cause));}catch{return true;}
  if(a.stars!==expected)return true;
  if(m.index!=='company'){const key=`${m.index}:${m.session}`;if(slots.has(key))return true;slots.add(key);}
 }
 return false;
}
/** One-off, owner-requested re-selection of TODAY's stored day under the current rules (Nov 25: three NVIDIA stories, all ★5 on
 * the same TP半導体40 move, had to be hidden by hand). Runs only when RESOLUTE_SHOCK_GAUGE_RESELECT_DAY names today's JST date,
 * after that day's morning run, when the stored day is ready and breaks the current rules (breaksCurrentRules). The day is re-run
 * with the morning run's clock (08:20 JST), so only stories published before that run are read, exactly as the morning run did.
 * The stored day is replaced only by a run that keeps at least one story; on any failure the stored day stays as it was.
 * Once replaced, the stored day satisfies the rules, so the flag left in place never runs it again. */
export async function reselectStoredDay({env=process.env,realNow=new Date(),publishPool,...options}){
 const day=env?.RESOLUTE_SHOCK_GAUGE_RESELECT_DAY;
 if(!day)return {state:'reselect-off'};
 if(day!==riskDate(realNow)||realNow.getTime()<dailyRunStart(day)+60*60000)return {state:'reselect-not-today',day};
 const row=(await publishPool.query("SELECT state,articles FROM resolute.risk_days WHERE day=$1::date",[day])).rows[0];
 if(row?.state!=='ready'||!breaksCurrentRules(row.articles))return {state:'reselect-not-needed',day};
 const result=await prepareDailyReview({...options,enabled:true,publishPool,now:new Date(dailyRunStart(day)+20*60000),replace:{articles:row.articles,at:realNow}});
 return {...result,state:`reselected-${result.state}`};
}
/** Read-only preview for the owner (RIZEL_DAILY_REVIEW_DRY_RUN): what the selection would pick, with each story's scope, index,
 * close and the stars that close gives. No model call, no writes. Headlines only (public text), never bodies or URLs. */
export function previewSelection(intake,moves){
 // marketStars: before the model's cause step (no model call here), so the published star can differ by one.
 const show=c=>{const {session,index}=candidateSession(c);
  let reading=null;try{if(index!=='company'&&session)reading=applyMarketReaction({publishedAt:c.publishedAt,market:{index,session,reading:null},stars:null},moves??{}).market.reading;}catch{reading=null;}
  return {title:c.title,scope:storyScope(c.title),index,session,reading,marketStars:readingStars(reading)};};
 return {selected:intake.selected.map(show),next:intake.reserve.slice(0,6).map(show),diagnostics:intake.diagnostics};
}
