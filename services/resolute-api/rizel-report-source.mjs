import {boundedJSON} from './risk-store.mjs';

// Separate, opt-in reporting intake. Does not enable the home feed or access
// editor/monitor credentials. Only the provider API is fetched, never articles.
export function createReportReader({enabled=false,token,tickers,fetcher=fetch}={}){
 if(!enabled)return null;
 if(typeof token!=='string'||!token.trim()||token.length>512||/[\s\x00-\x1f]/.test(token))throw Error('REPORT_SOURCE_CONFIG');
 if(typeof tickers!=='string')throw Error('REPORT_SOURCE_CONFIG');
 const roster=[...new Set(tickers.split(','))];
 if(!roster.length||roster.length>50||roster.some(t=>! /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(t)))throw Error('REPORT_SOURCE_CONFIG');
 return async()=>{
  try{
   const url=new URL('https://stocknewsapi.com/api/v1');
   url.search=new URLSearchParams({tickers:roster.join(','),items:'100',page:'1',token}).toString();
   const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('UNAVAILABLE');
   const payload=await boundedJSON(response,2000000);
   if(!payload||!Array.isArray(payload.data)||payload.data.length>100)throw Error('INVALID_RESPONSE');
   const items=[];
   for(const row of payload.data){
    if(!row||typeof row!=='object'||!Array.isArray(row.tickers)||row.tickers.some(t=>typeof t!=='string'))throw Error('INVALID_ITEM');
    if(!row.tickers.some(t=>roster.includes(t)))continue;
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
    items.push({title:row.title.trim(),bodyEn:row.text.trim(),url:article.href,publishedAt:new Date(row.date).toISOString(),publisher:row.source_name.trim()});
   }
   // A full page is a bounded sample, not proof of exhaustive market coverage.
   return {items,returned:payload.data.length,possiblyTruncated:payload.data.length===100};
  }catch{throw Error('REPORT_SOURCE_UNAVAILABLE');}
 };
}

export function withReportReader(readOfficial,readReports){
 if(!readReports)return readOfficial;
 return async()=>{
  const official=await readOfficial();
  const report=await readReports();
  return {...official,reportUpdates:report.items,reportCoverage:{configured:true,returned:report.returned,possiblyTruncated:report.possiblyTruncated}};
 };
}
