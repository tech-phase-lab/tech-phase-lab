import 'server-only';
import { parseResultBriefs, resultEvents } from './market-results';

export async function loadLiveResultEvents() {
  try {
    const base=process.env.RESEARCH_MONITOR_URL, token=process.env.RESEARCH_MONITOR_TOKEN;
    if(!base||!token)return [];
    const url=new URL(base);
    if(url.protocol!=='https:'||url.username||url.password) return [];
    url.pathname=url.pathname.replace(/\/$/,'')+'/news';url.search='';url.hash='';
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)return [];
    const text=await response.text();if(new TextEncoder().encode(text).length>500000)return [];
    return resultEvents(parseResultBriefs(JSON.parse(text).resultBriefs));
  }catch{return [];}
}
