import 'server-only';
import { buildPublicNews } from './public-news-response';
import type { InitialNewsSnapshot } from './general-news';
import { parseResultBriefs, resultEvents } from './market-results';
import { officialResultEvents } from './official-result-events';

export async function loadLiveHomeNews() {
  const empty = { events: [] as ReturnType<typeof resultEvents>, news: null as InitialNewsSnapshot | null };
  try {
    const base=process.env.RESEARCH_MONITOR_URL, token=process.env.RESEARCH_MONITOR_TOKEN;
    if(!base||!token)return empty;
    const url=new URL(base);
    if(url.protocol!=='https:'||url.username||url.password) return empty;
    url.pathname=url.pathname.replace(/\/$/,'')+'/news';url.search='';url.hash='';
    if (process.env.VERCEL_ENV === "preview") url.searchParams.set("originalPreview", "1");
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)return empty;
    const text=await response.text();if(new TextEncoder().encode(text).length>500000)return empty;
    const payload=JSON.parse(text);
    let issuerEvents: ReturnType<typeof officialResultEvents> = [];
    let numericalEvents: ReturnType<typeof resultEvents> = [];
    try { issuerEvents=officialResultEvents(payload.officialResearch); } catch { /* Hold invalid issuer notes only. */ }
    try { numericalEvents=resultEvents(parseResultBriefs(payload.resultBriefs)); } catch { /* Hold invalid flashes only. */ }
    let news: InitialNewsSnapshot | null = null;
    try { news = { data: buildPublicNews(payload, { allowOriginalPreview: process.env.VERCEL_ENV === "preview" }), checkedAt: Date.now() }; } catch { /* Client refresh reports/retries unavailable news. */ }
    return { events: [...issuerEvents, ...numericalEvents], news };
  }catch{return empty;}
}

export async function loadLiveResultEvents() { return (await loadLiveHomeNews()).events; }
