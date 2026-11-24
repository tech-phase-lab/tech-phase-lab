import {boundedJSON} from './risk-store.mjs';
import {sourceError} from './rizel-news-source.mjs';

// One provider page is 100 rows; at most two lanes (company + market-wide).
export const REPORT_PAGE_ITEMS=100;
export const REPORT_LANES_MAX=2;
// Nov 24: one page per lane reached back only about four hours of the 30-hour window (the busy market lane fills 100 rows
// in a few hours), so most of the day's stories were never seen. The daily read now pages back until it passes the window
// start. Default 30 pages per lane (Monday reaches back 78 hours), hard ceiling 40; RESOLUTE_REPORT_MAX_PAGES lowers it.
export const REPORT_MAX_PAGES_DEFAULT=30;
export const REPORT_MAX_PAGES_CAP=40;
export const REPORT_UPDATES_LIMIT=REPORT_PAGE_ITEMS*REPORT_LANES_MAX*REPORT_MAX_PAGES_CAP;
/** Pages per lane from RESOLUTE_REPORT_MAX_PAGES (1..40); anything else is the default. */
export function reportMaxPages(raw=process.env.RESOLUTE_REPORT_MAX_PAGES){
 const n=typeof raw==='string'&&/^\d{1,2}$/.test(raw.trim())?Number(raw.trim()):NaN;
 return n>=1&&n<=REPORT_MAX_PAGES_CAP?n:REPORT_MAX_PAGES_DEFAULT;
}
// Fixed reasons a reporting read failed; logged as `check` (never the URL, token or body).
export const REPORT_CHECKS=Object.freeze(['report-network','report-http-4xx','report-http-5xx','report-not-json','report-shape','report-rows-invalid']);

// Separate, opt-in reporting intake. Does not enable the home feed or access
// editor/monitor credentials. Only the provider API is fetched, never articles.
export function createReportReader({enabled=false,token,tickers,marketWide=false,maxPages=REPORT_MAX_PAGES_DEFAULT,fetcher=fetch}={}){
 if(!enabled)return null;
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>REPORT_MAX_PAGES_CAP)throw Error('REPORT_SOURCE_CONFIG');
 if(typeof token!=='string'||!token.trim()||token.length>512||/[\s\x00-\x1f]/.test(token))throw Error('REPORT_SOURCE_CONFIG');
 if(typeof tickers!=='string')throw Error('REPORT_SOURCE_CONFIG');
 const roster=[...new Set(tickers.split(','))];
 if(!roster.length||roster.length>50||roster.some(t=>! /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(t)))throw Error('REPORT_SOURCE_CONFIG');
 const readPage=async(lane,page)=>{
  const url=new URL(lane==='market'?'https://stocknewsapi.com/api/v1/category':'https://stocknewsapi.com/api/v1');
  const params={items:String(REPORT_PAGE_ITEMS),page:String(page),token};
  if(lane==='market')params.section='general';else params.tickers=roster.join(',');
  url.search=new URLSearchParams(params).toString();
  const fail=(check,retryable)=>{const e=sourceError('UNAVAILABLE',retryable);e.check=check;return e;};
  let response;
  try{response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{throw fail('report-network',true);} // network error or timeout: worth another try
  if(!response.ok)throw fail(response.status>=500?'report-http-5xx':'report-http-4xx',response.status>=500);
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw fail('report-not-json',false);
  let payload;
  try{payload=await boundedJSON(response,2000000);}catch{throw fail('report-not-json',false);}
  if(!payload||!Array.isArray(payload.data)||payload.data.length>REPORT_PAGE_ITEMS)throw fail('report-shape',false);
  const items=[];let skipped=0;
  for(const row of payload.data){
   // One malformed article is dropped (and counted), never published; it must not cost the whole day's review.
   let item;
   try{item=reportItem(row,lane,roster);}catch{skipped++;continue;}
   if(item)items.push(item);
  }
  // A page where every row is malformed means the provider's format changed: fail closed instead of a false quiet day.
  if(payload.data.length&&skipped===payload.data.length)throw fail('report-rows-invalid',false);
  const oldest=payload.data.map(r=>Date.parse(r?.date)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  return {items,skipped,returned:payload.data.length,oldest:Number.isFinite(oldest)?oldest:null};
 };
 // Without `since` one page is read (diagnostics). With it, pages are read until one reaches back to `since`, a page comes back
 // short (the provider has nothing older), or the page budget runs out. A refused later page (the plan's page limit) ends the
 // paging and leaves the lane marked as possibly truncated; a refused first page still fails the read.
 const readLane=async(lane,since)=>{
  const pages=Number.isFinite(since)?maxPages:1;
  const out={items:[],skipped:0,returned:0,pages:0,possiblyTruncated:false,oldest:null};
  for(let page=1;page<=pages;page++){
   let result;
   try{result=await readPage(lane,page);}
   catch(error){if(page>1&&error?.check==='report-http-4xx'){out.possiblyTruncated=true;break;}throw error;}
   out.pages++;out.items.push(...result.items);out.skipped+=result.skipped;out.returned+=result.returned;
   if(result.oldest!==null)out.oldest=out.oldest===null?result.oldest:Math.min(out.oldest,result.oldest);
   // A full page is a bounded sample, not proof of exhaustive coverage. Report how far back it reached.
   // With `since`, a full page that already reaches back to it is complete coverage of the window.
   const full=result.returned===REPORT_PAGE_ITEMS,reached=Number.isFinite(since)&&result.oldest!==null&&result.oldest<=since;
   out.possiblyTruncated=full&&!reached;
   if(!full||!Number.isFinite(since)||reached)break;
  }
  return {...out,oldestPublishedAt:out.oldest===null?null:new Date(out.oldest).toISOString()};
 };
 return async({since}={})=>{
  try{
   const company=await readLane('company',since);
   // Market-wide lane (macro, policy, sector-wide stress). Any failure fails the whole read: no false quiet day.
   const market=marketWide?await readLane('market',since):null;
   const seen=new Set(),items=[];
   for(const item of [...company.items,...(market?.items??[])])if(!seen.has(item.url)){seen.add(item.url);items.push(item);}
   const lanes=[company,market].filter(Boolean);
   const oldest=lanes.map(l=>l.oldestPublishedAt).filter(Boolean).sort().pop()??null; // the shallowest lane limits coverage
   return {items,skipped:lanes.reduce((n,l)=>n+l.skipped,0),returned:lanes.reduce((n,l)=>n+l.returned,0),pages:lanes.reduce((n,l)=>n+l.pages,0),possiblyTruncated:lanes.some(l=>l.possiblyTruncated),oldestPublishedAt:oldest,marketLane:!!market};
  }catch(error){const e=sourceError('REPORT_SOURCE_UNAVAILABLE',error?.retryable===true);if(typeof error?.check==='string')e.check=error.check;throw e;}
 };
}

/** One provider row as a report item, null when it names no rostered ticker (company lane), or throws when malformed. */
function reportItem(row,lane,roster){
 if(!row||typeof row!=='object')throw Error('INVALID_ITEM');
 // General market news carries no ticker list; company news must name a rostered ticker.
 const rowTickers=lane==='market'&&(row.tickers===undefined||row.tickers===null)?[]:row.tickers;
 if(!Array.isArray(rowTickers)||rowTickers.some(t=>typeof t!=='string'))throw Error('INVALID_ITEM');
 if(lane==='company'&&!rowTickers.some(t=>roster.includes(t)))return null;
 if(typeof row.title!=='string'||!row.title.trim()||row.title.length>2000||typeof row.text!=='string'||!row.text.trim()||row.text.length>12000||typeof row.source_name!=='string'||!row.source_name.trim()||row.source_name.length>500)throw Error('INVALID_ITEM');
 const article=new URL(row.news_url);
 if(article.protocol!=='https:'||article.username||article.password||article.port||article.href.length>2048||!article.hostname.includes('.')||/^[\d.]+$/.test(article.hostname)||article.hostname.startsWith('['))throw Error('INVALID_URL');
 // Require the RFC-style offset supplied by the provider. Never assume a
 // server timezone for an unzoned date or use acquisition time as publication.
 const clock=typeof row.date==='string'&&/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (?:[+-](?:[01]\d|2[0-3])[0-5]\d|GMT|UTC)$/.exec(row.date);
 if(!clock||!Number.isFinite(Date.parse(row.date)))throw Error('INVALID_DATE');
 const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(clock[2]);
 const calendar=new Date(Date.UTC(Number(clock[3]),month,Number(clock[1])));
 if(calendar.getUTCFullYear()!==Number(clock[3])||calendar.getUTCMonth()!==month||calendar.getUTCDate()!==Number(clock[1]))throw Error('INVALID_DATE');
 // The provider's own sentiment and the lane are ranking hints only (rizel-daily-review): never shown, never a reason to publish.
 const sentiment=typeof row.sentiment==='string'?row.sentiment.trim().toLowerCase():'';
 return {title:row.title.trim(),bodyEn:row.text.trim(),url:article.href,publishedAt:new Date(row.date).toISOString(),publisher:row.source_name.trim(),tickers:rowTickers.filter(t=>/^[A-Z][A-Z0-9.]{0,9}$/.test(t)).slice(0,30),
  lane,...(['positive','negative','neutral'].includes(sentiment)?{sentiment}:{}),...(typeof row.type==='string'&&row.type.trim().toLowerCase()==='video'?{video:true}:{})};
}

export function withReportReader(readOfficial,readReports){
 if(!readReports)return readOfficial;
 return async(options={})=>{
  const official=await readOfficial();
  const report=await readReports(options);
  return {...official,reportUpdates:report.items,reportCoverage:{configured:true,returned:report.returned,...(Number.isSafeInteger(report.pages)?{pages:report.pages}:{}),possiblyTruncated:report.possiblyTruncated,oldestPublishedAt:report.oldestPublishedAt??null,marketLane:report.marketLane===true,skipped:Number.isSafeInteger(report.skipped)?report.skipped:0}};
 };
}
