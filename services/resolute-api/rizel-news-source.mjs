import {boundedJSON} from './risk-store.mjs';
import {buildPublicNews} from '../../lib/research/public-news-response.ts';

/** Dedicated GET-only capability. No browser credentials or broad editor token. */
export function createNewsReader({origin,token,fetcher=fetch}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||typeof token!=='string'||token.length<32||/[\s\r\n]/.test(token))throw Error('SOURCE_CONFIG');
 url.pathname='/internal/resolute/news';
 return async()=>{
  const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('SOURCE_UNAVAILABLE');
  const raw=await boundedJSON(response,500000);
  if(raw?.ok!==true)throw Error('SOURCE_UNAVAILABLE');
  return buildPublicNews(raw);
 };
}
