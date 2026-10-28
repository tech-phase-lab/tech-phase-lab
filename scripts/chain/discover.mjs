import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {contains} from './evidence.mjs';
const {parse}=createRequire(import.meta.url)('node-html-parser');

const SEEDS={
 BE:['https://www.bloomenergy.com/news/'],
 NVDA:['https://nvidianews.nvidia.com/news'],
 NBIS:['https://nebius.com/newsroom'],
 ORCL:['https://www.oracle.com/news/'],
 MU:['https://investors.micron.com/latest-news','https://www.micron.com/about/press/news'],
};
const RELATION=/partner|collaborat|contract|agreement|invest|acquir|suppl|select|deploy|customer|adopt|power|launch/i;
const NEWS=/news|press|release|announcement/i;
const isSec=url=>{try{return /(^|\.)sec\.gov$/.test(new URL(url).hostname)}catch{return false}};
const clean=(href,base)=>{try{const u=new URL(href,base);u.hash='';if(u.protocol!=='https:'||/\.(pdf|png|jpe?g|zip|xlsx?|docx?|mp4)$/i.test(u.pathname))return null;return u.href}catch{return null}};
const links=(page,url)=>parse(page.html??'').querySelectorAll('a[href]').map(a=>({url:clean(a.getAttribute('href'),url),text:a.text.trim(),rel:a.getAttribute('rel')??'',...listingDate(a,url)})).filter(a=>a.url);
const datesIn=body=>[...String(body??'').matchAll(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/g)].map(m=>new Date(m[0]+' UTC')).filter(d=>Number.isFinite(+d)).map(d=>d.toISOString().slice(0,10));
const individual=path=>/news-details|news-release-details|announcement\/|press-release\/|\/news\/[^/]+|\/newsroom\/[^/]+|\/releases\/[^/]+|\/20\d{2}-\d{2}-\d{2}[-/][^/]+|\/node\/\d+\/?$|\/newsletters?\/[^/]+/i.test(path);
function listingDate(anchor,base){
 let node=anchor.parentNode,featured=false;
 for(let depth=0;node&&depth<5;depth++,node=node.parentNode){
  const cls=node.getAttribute?.('class')??'';
  featured ||= /featured|hero|recommended|related|recent-post/i.test(cls);
  const targets=new Set((node.querySelectorAll?.('a[href]')??[]).map(a=>clean(a.getAttribute('href'),base)).filter(url=>url&&individual(new URL(url).pathname)));
  if(targets.size>1)break; // Never borrow the date of a neighbouring story.
  const marked=node.querySelector?.('time[datetime],.blogdate,.date,.published,[class*="publish-date"],[class*="post-date"]');
  const raw=marked?.getAttribute('datetime')??marked?.text;
  const dates=datesIn(raw??(/listing|card|news-item|article-item/i.test(cls)?node.text:''));
  if(dates.length===1)return {listing_date:dates[0],listing_primary:/listing|card|news-list|news-item|article-item/i.test(cls),listing_featured:featured};
 }
 return {};
}
async function pool(items,fn,size=5){let i=0;await Promise.all(Array.from({length:Math.min(items.length,size)},async()=>{while(i<items.length){const item=items[i++];await fn(item)}}));}

/** Source-first discovery. Bounds are reported as incomplete coverage, never completeness. */
export async function discover({roots,profiles,universe,domains,get,asOf='2026-10-18',since='2024-10-18',limits={},resume={},includePartners=true,collectSec=true}){
 const documents=[],checks=[],coverage={},stopReasons=[];
 const requests=new Map(),documentKeys=new Set();
 // The supplied fetcher owns rate limiting and bounded retry policy. A failed
 // URL is recorded and skipped here; it never cancels another issuer or page.
 const companies=universe instanceof Map?universe:new Map((universe.companies??universe).map(c=>[c.id,c]));
 async function fetchPage(url,ticker,kind){
  if(requests.has(url))return requests.get(url);
  const pending=(async()=>{
   let result;try{result=await get(url)}catch(e){result={url,error:'fetch_unavailable',detail:e.message}}
   if(!result.error&&result.status>=400)result={...result,error:`http_${result.status}`};
   checks.push({ticker,kind,source_url:url,status:result.status??null,error:result.error??null});
   return result;
  })();requests.set(url,pending);return pending;
 }
 function add(url,issuer,source,filing){
  const key=issuer+'|'+url;if(source.error||documentKeys.has(key))return;
  documentKeys.add(key);documents.push({url,issuer,...(filing?{filing}:{}),source});
 }
 async function sec(ticker){
  const p=profiles.find(p=>p.tickers?.includes(ticker)),c=companies.get(ticker);
  const cik=Number(c?.cik??p?.cik);
  const state=coverage[ticker].sec={latest10K:null,filingsInWindow:0,documentsFetched:0,complete:false};
  if(!cik){state.reason='issuer_cik_unavailable';return;}
  const base='https://data.sec.gov/submissions/';
  const head=await fetchPage(`${base}CIK${String(cik).padStart(10,'0')}.json`,ticker,'sec_submissions');
  if(head.error){state.reason='sec_unavailable';return;}
  let data;try{data=JSON.parse(head.html)}catch{state.reason='invalid_submissions_json';const check=checks.find(c=>c.source_url===`${base}CIK${String(cik).padStart(10,'0')}.json`);if(check)check.error='invalid_submissions_json';return;}
  const filings=[];
  const append=table=>{for(let i=0;i<(table?.accessionNumber?.length??0);i++)filings.push({cik,accession:table.accessionNumber[i],form:table.form[i],date:table.filingDate[i],primaryDocument:table.primaryDocument[i]})};
  append(data.filings?.recent);
  // The recent table is limited to approximately 1,000 filings. Follow history
  // files covering the requested window, plus older files until a 10-K exists.
  const history=[...(data.filings?.files??[])].sort((a,b)=>String(b.filingTo).localeCompare(String(a.filingTo)));
  for(const file of history){
   const hasAnnual=filings.some(f=>f.form==='10-K'&&f.date<=asOf);
   if(file.filingFrom>asOf||(file.filingTo<since&&hasAnnual))continue;
   const page=await fetchPage(base+file.name,ticker,'sec_submissions_history');
   if(page.error)continue;
   try{append(JSON.parse(page.html))}catch{const check=checks.find(c=>c.source_url===base+file.name);if(check)check.error='invalid_submissions_json';state.reason='invalid_submissions_json';}
  }
  const unique=[...new Map(filings.map(f=>[f.accession,f])).values()].filter(f=>f.date<=asOf);
  const latest=unique.filter(f=>f.form==='10-K').sort((a,b)=>b.date.localeCompare(a.date))[0];
  state.latest10K=latest?.accession??null;
  const selected=unique.filter(f=>(['8-K','10-Q'].includes(f.form)&&f.date>=since)||f.accession===latest?.accession);
  state.filingsInWindow=selected.length;
  await pool(selected,async filing=>{
   if(!filing.primaryDocument){state.reason='missing_primary_document';return;}
   const directory=`https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replaceAll('-','')}/`;
   const url=directory+filing.primaryDocument,page=await fetchPage(url,ticker,'sec_'+filing.form);
   if(page.error)return;
   state.documentsFetched++;add(url,ticker,page,filing);
   if(filing.form!=='8-K')return;
   // Exhibits inherit the parent accession's EDGAR filing date and form.
   const exhibits=links(page,url).filter(a=>a.url.startsWith(directory)&&/ex(?:hibit)?[-_\s.]?99|ex99|99\.1|99\.2|press release|news release/i.test(a.url+' '+a.text)&&/\.html?($|\?)/i.test(a.url));
   await pool([...new Set(exhibits.map(a=>a.url))],async exhibitUrl=>{
    const exhibit=await fetchPage(exhibitUrl,ticker,'sec_8-K_exhibit');add(exhibitUrl,ticker,exhibit,filing);
   },2);
  },2);
  state.complete=state.documentsFetched===selected.length&&!checks.some(x=>x.ticker===ticker&&x.kind.startsWith('sec_')&&x.error);
  if(!latest)state.annualNote='No 10-K found; foreign issuers may file 20-F, which is not an allowed relationship source.';
 }
 async function newsroom(ticker){
  const allowed=(domains[ticker]?.domains??[]).map(d=>d.host);
  const official=url=>{try{const host=new URL(url).hostname;return allowed.some(d=>host===d||host.endsWith('.'+d))}catch{return false}};
  const state=coverage[ticker].newsroom={since,asOf,indexPages:0,articlePages:0,datedArticles:0,complete:false,limits:{indexPages:limits.indexPages??12,articlePages:limits.articlePages??120},notes:[]};
  if(!allowed.length){state.notes.push('official_domains_not_registered');state.reason='official_domains_not_registered';return;}
  const profile=profiles.find(p=>p.tickers?.includes(ticker));
  const seeds=[...(SEEDS[ticker]??[])];
  // Profile sources are used solely to locate a publisher's navigation root.
  // No existing relationship entry or its sourceIndexes participates here.
  if(!seeds.length){
   for(const d of domains[ticker]?.domains??[])if(d.source_url&&!isSec(d.source_url)&&official(d.source_url))seeds.push(d.source_url);
   for(const s of profile?.sources??[]){if(!official(s.url))continue;const u=new URL(s.url);seeds.push(u.origin+'/');}
   for(const host of allowed)seeds.push(`https://${host}/`);
  }
  const saved=resume[ticker]??{};
  const queue=[...new Set((saved.pendingIndexUrls??seeds).filter(official))],visited=new Set(saved.visitedIndexUrls??[]),processed=new Set(saved.processedArticleUrls??[]),fingerprints=new Set(saved.indexFingerprints??[]),articles=new Map((saved.pendingArticles??[]).filter(a=>official(a.url)).map(a=>[a.url,a]));
  if(!queue.length&&!articles.size&&!saved.visitedIndexUrls?.length){state.notes.push('no_registered_official_navigation_seed');state.reason='no_registered_official_navigation_seed';return;}
  while(queue.length&&state.indexPages<state.limits.indexPages){
   const url=queue.shift();if(visited.has(url))continue;visited.add(url);state.indexPages++;
   const page=await fetchPage(url,ticker,'newsroom_index');if(page.error){state.notes.push('unavailable_page_skipped');continue;}
   // Index dates often belong to a listed article. Never admit an index or
   // navigation seed as evidence; only separately discovered release pages.
   const found=links(page,page.finalUrl??url).filter(a=>official(a.url));
   const articleLinks=found.filter(a=>individual(new URL(a.url).pathname)).map(a=>a.url).sort();
   const indexUrl=new URL(url);
   const fingerprint=createHash('sha256').update(indexUrl.origin+indexUrl.pathname+'\n'+(articleLinks.length?articleLinks.join('\n'):(page.body??page.html??''))).digest('hex');
   if(fingerprints.has(fingerprint)){state.notes.push('repeated_archive_content_skipped');continue;}fingerprints.add(fingerprint);
   const datedListings=found.filter(a=>a.listing_date&&!a.listing_featured);
   const primaryListings=datedListings.filter(a=>a.listing_primary);
   const dates=(primaryListings.length?primaryListings:datedListings).map(a=>a.listing_date);
   if(!dates.length)dates.push(...datesIn(page.body));if(!dates.length&&page.date)dates.push(page.date);
   if(NEWS.test(indexUrl.pathname+' '+indexUrl.hostname)&&dates.length&&dates.every(date=>date<since)){state.notes.push('archive_before_window_frontier');continue;}
   for(const a of found){
    const u=new URL(a.url),path=u.pathname;
    if(a.listing_date&&(a.listing_date<since||a.listing_date>asOf))continue;
    if(!NEWS.test(path)&&!NEWS.test(a.text)&&!individual(path))continue;
    const years=[...path.matchAll(/(?:\/|-)(20\d{2})(?=\/|-)/g)].map(m=>Number(m[1]));
    if([...u.searchParams].some(([key,value])=>/year/i.test(key)&&/^20\d{2}$/.test(value)&&Number(value)<Number(since.slice(0,4))))continue;
    for(const [key,value] of u.searchParams)if(/year/i.test(key)&&/^20\d{2}$/.test(value))years.push(Number(value));
    if(years.length&&years.every(y=>y<Number(since.slice(0,4))))continue;
    const pager=[...u.searchParams.keys()].find(k=>/^(page|p|offset)$/i.test(k));
    const current=new URL(url),nextLabel=/\bnext\b|\bolder\b|load more|more news/i.test(a.text)||a.rel.split(/\s+/).includes('next');
    const pathPage=path.match(/\/page\/(\d+)\/?$/i);
    if(pathPage){const prior=Number(current.pathname.match(/\/page\/(\d+)\/?$/i)?.[1]??1);if(Number(pathPage[1])!==prior+1||/last|first|previous|newer/i.test(a.text))continue;}
    // Follow only the adjacent numeric page or an explicit next/older control.
    // Never follow "last" or arbitrary numbered-page jumps.
    if(pager){const target=Number(u.searchParams.get(pager)),prior=Number(current.searchParams.get(pager)??0);if(/last|first|previous|newer/i.test(a.text)||(!nextLabel&&(pager.toLowerCase()==='offset'||target!==prior+1)))continue;}
    const paginated=/next|older|more news|load more|archive|newsroom|press releases|news releases/i.test(a.text)||a.rel==='next'||/[?&](page|p|offset|year)=/.test(a.url);
    const archive=/\/(?:category|categories|tags?|archive|archives|page)\//i.test(path)||/\/20\d{2}(?:\/\d{1,2})?\/?$/.test(path)||/[?&](page|p|offset|year)=/.test(a.url);
    const article=!archive&&individual(path)&&!/^\s*(news|newsroom|press releases|news releases|next|older)\s*$/i.test(a.text);
    if(article)articles.set(a.url,a);
    else if(paginated||/\/(news|newsroom|press|press-releases|news-releases|latest-news)\/?$/i.test(path))if(!visited.has(a.url)&&!queue.includes(a.url))queue.push(a.url);
   }
  }
  const prioritized=[...articles.values()].filter(a=>!visited.has(a.url)&&!processed.has(a.url)).sort((a,b)=>Number(RELATION.test(b.text+' '+b.url))-Number(RELATION.test(a.text+' '+a.url)));
  if(queue.length)state.notes.push('index_page_limit_reached');
  if(prioritized.length>state.limits.articlePages)state.notes.push('article_page_limit_reached');
  await pool(prioritized.slice(0,state.limits.articlePages),async a=>{
   state.articlePages++;processed.add(a.url);const page=await fetchPage(a.url,ticker,'newsroom_article');if(page.error)return;
   if(page.date>=since&&page.date<=asOf){state.datedArticles++;add(a.url,ticker,page);}
   else if(!page.date)state.notes.push('article_without_publication_date');
  },2);
  state.continuation={pendingIndexUrls:queue,pendingArticles:prioritized.filter(a=>!processed.has(a.url)),visitedIndexUrls:[...visited],processedArticleUrls:[...processed],indexFingerprints:[...fingerprints]};
  state.hasMore=queue.length>0||state.continuation.pendingArticles.length>0;
  state.notes=[...new Set([...state.notes,'bounded_html_navigation_only; JavaScript-only archives and unlinked releases are not proven complete'])];
 }
 for(const ticker of roots)coverage[ticker]={};
 if(collectSec)await pool(roots,sec,2);
 await pool(roots,newsroom,2);
 if(includePartners){
  // One hop from names in newly fetched source text, never legacy candidates.
  // Partner-issued releases can supply evidence when an origin IR page fails.
  const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  const relationSentences=documents.flatMap(d=>[...segmenter.segment(d.source.body??'')].map(s=>s.segment).filter(text=>RELATION.test(text)&&roots.some(id=>{const root=companies.get(id);return root&&contains(text,{...root,aliases:root.aliases??[]})})));
  const partners=[...companies.values()].filter(c=>!roots.includes(c.id)&&relationSentences.some(text=>contains(text,{...c,aliases:c.aliases??[]}))).map(c=>c.id);
  for(const ticker of partners)coverage[ticker]={scope:'source_named_counterparty',roots};
  await pool(partners,newsroom,2);
 }
 return {documents,checks,coverage,stopReasons};
}
