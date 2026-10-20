import {inspectCandidateFeed,generate,publicationBounds} from './risk-job.mjs';
import {riskDate,parseRiskArticle} from '../../lib/resolute/risk.ts';
import {selectArticleForReview} from './rizel-worker.mjs';

/** Pure intake shared by the paid worker and read-only diagnostics. */
export function selectDailyCandidates(feed,now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('INVALID_CLOCK');
 const intake=inspectCandidateFeed(feed,now,{allowDateOnly:true});
 const diagnostics={...intake.diagnostics,outsideDailyWindow:0,duplicateHeadline:0,overDailyLimit:0};
 const seen=new Set();
 const selected=intake.candidates.filter(c=>{
  if(now.getTime()-publicationBounds(c.publishedAt).earliest>96*3600000){diagnostics.outsideDailyWindow++;return false;}
  if(seen.has(c.fingerprint)){diagnostics.duplicateHeadline++;return false;}
  seen.add(c.fingerprint);return true;
 });
 diagnostics.overDailyLimit=Math.max(0,selected.length-3);selected.splice(3);
 return {selected,diagnostics};
}

/** Trusted worker only, never a browser or customer read path.
 * No scheduler is enabled here. The owner must explicitly enable the worker.
 * Daily claims survive errors: retrying cannot silently repeat paid generation.
 */
export async function prepareDailyReview({enabled=false,readFeed,selectionPool,budgetPool,apiKey,
 now=new Date(),summarize=generate,select=selectArticleForReview,fetcher=fetch}) {
 if(!enabled)return {state:'disabled'};
 const jst=new Date(now.getTime()+9*3600000);
 if([0,6].includes(jst.getUTCDay())||jst.getUTCHours()!==7)return {state:'outside-window'};
 const day=riskDate(now);
 const claim=await selectionPool.query(`INSERT INTO public.resolute_rizel_daily_runs(day,state,started_at)
 VALUES($1,'processing',$2) ON CONFLICT DO NOTHING RETURNING day`,[day,now.toISOString()]);
 if(!claim.rows.length)return {state:'already-claimed',day};
 const refs=[];let stage='source',diagnostics;
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
   if(article.id!==candidate.id||article.url!==candidate.url)throw Error('ARTICLE_MISMATCH');
   // Model classification is not verified evidence for D's factual conditions.
   const result=await select({article,evidence:[],selectionPool,budgetPool,apiKey,now});
   if(result.publication!=='withheld'||result.state!=='selected')throw Error('SELECTION_UNAVAILABLE');
   refs.push({articleId:result.articleId,articleRevision:result.articleRevision});
   await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET selection_refs=$2 WHERE day=$1',[day,JSON.stringify(refs)]);
  }
  if(selected.length&&!refs.length)throw Error('NO_VERIFIED_OUTPUT');
  stage='readback';
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='ready',finished_at=$2 WHERE day=$1",[day,new Date().toISOString()]);
  const saved=(await selectionPool.query('SELECT state,candidate_count,selection_refs,publication FROM public.resolute_rizel_daily_runs WHERE day=$1',[day])).rows[0];
  if(saved?.state!=='ready'||saved.candidate_count!==selected.length||saved.publication!=='withheld'||!Array.isArray(saved.selection_refs)||saved.selection_refs.length!==refs.length||refs.some((ref,i)=>saved.selection_refs[i]?.articleId!==ref.articleId||saved.selection_refs[i]?.articleRevision!==ref.articleRevision))throw Error('READBACK_MISMATCH');
  return {state:refs.length?'ready':'no-candidates',day,count:refs.length,publication:'withheld',storageVerified:true,diagnostics};
 }catch{
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='failed',finished_at=$2 WHERE day=$1",[day,now.toISOString()]);
  const error=new Error('PRIVATE_DAILY_REVIEW_FAILED');error.stage=stage;error.diagnostics=diagnostics;throw error;
 }
}
