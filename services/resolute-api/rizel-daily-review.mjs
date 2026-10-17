import {candidatesFromFeed,generate} from './risk-job.mjs';
import {riskDate,parseRiskArticle} from '../../lib/resolute/risk.ts';
import {selectArticleForReview} from './rizel-worker.mjs';

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
 const refs=[];
 try{
  const candidates=candidatesFromFeed(await readFeed(),now),seen=new Set();
  const selected=candidates.filter(c=>{
   if(now-new Date(c.publishedAt)>96*3600000||seen.has(c.fingerprint))return false;
   seen.add(c.fingerprint);return true;
  }).slice(0,3);
  await selectionPool.query('UPDATE public.resolute_rizel_daily_runs SET candidate_count=$2 WHERE day=$1',[day,selected.length]);
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
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='ready',finished_at=$2 WHERE day=$1",[day,now.toISOString()]);
  return {state:'ready',day,count:refs.length,publication:'withheld'};
 }catch{
  await selectionPool.query("UPDATE public.resolute_rizel_daily_runs SET state='failed',finished_at=$2 WHERE day=$1",[day,now.toISOString()]);
  throw Error('PRIVATE_DAILY_REVIEW_FAILED');
 }
}
