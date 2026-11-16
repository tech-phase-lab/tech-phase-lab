import {boundedJSON} from './risk-store.mjs';
import {buildPublicNews} from '../../lib/research/public-news-response.ts';

/** Dedicated GET-only capability. No browser credentials or broad editor token. */
export function createNewsReader({origin,token,fetcher=fetch}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||typeof token!=='string'||token.length<32||/[\s\r\n]/.test(token))throw Error('SOURCE_CONFIG');
 url.pathname='/internal/resolute/news';
 return async()=>{
  let response;
  // Network errors and timeouts (the monitor restarting or deploying) are worth another try; so is a 5xx. A 4xx is not.
  try{response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw sourceError('SOURCE_UNAVAILABLE',true);}
  if(!response.ok)throw sourceError('SOURCE_UNAVAILABLE',response.status>=500);
  const raw=await boundedJSON(response,500000);
  if(raw?.ok!==true)throw sourceError('SOURCE_UNAVAILABLE',false);
  return buildPublicNews(raw);
 };
}

export function sourceError(message,retryable){const error=Error(message);error.retryable=retryable===true;return error;}

// Owner, Nov 16: the daily review crashed at 07:01 JST (stage "source") while the research monitor was restarting.
// Five attempts over about ten minutes: waits of 1, 2, 3 and 4 minutes between them.
export const SOURCE_RETRY_DELAYS_MS=[60000,120000,180000,240000];

/** Retry a source read on retryable failures (network error, timeout, 5xx). Each failed attempt is logged with its number
 * (no URLs, tokens or response bodies). ``stats`` tells the caller how many attempts were made and whether they ran out. */
export function withSourceRetry(read,{delaysMs=SOURCE_RETRY_DELAYS_MS,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=line=>console.log(JSON.stringify(line))}={}){
 const stats={attempts:0,exhausted:false};
 const retrying=async()=>{
  const total=delaysMs.length+1;
  for(;;){
   stats.attempts++;
   try{return await read();}
   catch(error){
    const retryable=error?.retryable===true;
    const last=stats.attempts>=total;
    log({event:'RIZEL_DAILY_REVIEW_SOURCE_RETRY',attempt:stats.attempts,of:total,retryable,next:retryable&&!last?'retry':'give-up',
     ...(retryable&&!last?{waitSeconds:delaysMs[stats.attempts-1]/1000}:{})});
    if(!retryable)throw error;
    if(last){stats.exhausted=true;throw error;}
    await sleep(delaysMs[stats.attempts-1]);
   }
  }
 };
 retrying.stats=stats;
 return retrying;
}
