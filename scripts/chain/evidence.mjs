import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pacedRequest,retry429,secURL,validContact} from './retry.mjs';
const require=createRequire(import.meta.url);
const {parse}=require('node-html-parser');
export const normalize=s=>s.replace(/\s+/g,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const aliases=c=>[...new Set([c.name,...c.aliases,c.id])].filter(a=>a.length>=3);
export function hits(text,c){return aliases(c).flatMap(a=>[...text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(normalize(a))}(?![A-Za-z0-9])`,a===c.id&&/^[A-Z.]+$/.test(a)?'g':'gi'))].filter(m=>a!==c.id||!['NOW','APP','ALL','COST','FAST','TEAM'].includes(a)||/(?:NASDAQ|NYSE|ticker|symbol)\s*[:：]?\s*$|\(\s*$|\$$/i.test(text.slice(Math.max(0,m.index-20),m.index))).map(m=>({start:m.index,end:m.index+m[0].length}))).sort((a,b)=>a.start-b.start)}
export const contains=(text,c)=>hits(text,c).length>0;
export function bodyOf(html){const dom=parse(html);dom.querySelectorAll('script,style,nav,footer,aside,noscript,button,form,[aria-hidden="true"]').forEach(n=>n.remove());const heading=normalize((dom.querySelector('article h1')??dom.querySelector('main h1')??dom.querySelector('h1'))?.structuredText??'');dom.querySelectorAll('header').forEach(n=>n.remove());const body=normalize((dom.querySelector('article')??dom.querySelector('main')??dom).structuredText);return heading&&!body.includes(heading)?heading+' '+body:body;}
export function competitionSections(html){
 const doc=parse(html),sections=[];
 // Capture an actual heading and its following text, never a TOC reference.
 const heads=doc.querySelectorAll('h1,h2,h3,h4,p,div');
 for(const h of heads){if(!/^(?:Our\s+)?Competition(?:\s+and\s+Competitive\s+Conditions)?$/i.test(normalize(h.text)))continue;
  let text='',n=h.nextElementSibling,count=0;while(n&&count++<12){const t=normalize(n.structuredText);if(t.length<100&&t.length>3&&/^(?:[A-Z][A-Za-z]+\s*){1,7}$/.test(t)&&text.length>100)break;text+=' '+t;if(text.length>9000)break;n=n.nextElementSibling;}
  if(text.length>150)sections.push(normalize(text));
 }
 return [...new Set(sections)];
}
export function extractQuote(body,from,to,kind,role=''){
 const verb=role==='investor'||role==='investee'?/invest|equity|stake|sharehold/i:kind==='提携・出資・技術対応'?/partner|collaborat|joint venture|integrat|certif|qualifi|compatible|co-develop/i:kind==='競合'?/compet|rival/i:/suppl|manufactur|provid|adopt|deploy|purchas|custom|agreemen|select|use[sd]?\b|deliver|procure/i;
 const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(body)].map(s=>s.segment.trim());
 const full=sentences.filter(s=>s.length>=60&&s.length<=200&&s.split(' ').length<=25&&contains(s,from)&&contains(s,to)&&verb.test(s)&&!/sign in|sign up|opens in|About |privacy policy/i.test(s));
 if(full.length)return full.sort((a,b)=>b.length-a.length)[0];
 const a=hits(body,from),b=hits(body,to),choices=[];
 for(const x of a)for(const y of b){const lo=Math.min(x.start,y.start),hi=Math.max(x.end,y.end);if(hi-lo>200)continue;
  const previous=Math.max(body.lastIndexOf('. ',lo),body.lastIndexOf('; ',lo));
  const start=previous>=0&&hi-previous<=198?previous+2:lo;
  let end=Math.min(body.length,start+200);const sentenceEnd=body.indexOf('. ',hi);if(sentenceEnd>=hi&&sentenceEnd<end)end=sentenceEnd+1;else if(end<body.length){const space=body.lastIndexOf(' ',end);if(space>=hi)end=space;}
  const q=body.slice(start,end).trim().split(' ').slice(0,25).join(' ');
  if(q.length<80||/sign in|sign up|opens in|share this|cookie|privacy policy|About /i.test(q)||!verb.test(q))continue;
  if(!contains(q,from)||!contains(q,to))continue;
  if(kind!=='競合'&&!/suppl|manufactur|provid|partner|collaborat|adopt|deploy|integrat|invest|purchas|custom|agreemen|select|use[sd]?\b|power|develop|deliver/i.test(q))continue;
  if(kind==='競合'&&!/compet|rival/i.test(body.slice(Math.max(0,lo-200),Math.min(body.length,hi+200))))continue;
  // Preserve original contiguous text; no inserted issuer names or ellipses.
  choices.push(q);
 }
 return choices.sort((a,b)=>(/\.$/.test(b)?1:0)-(/\.$/.test(a)?1:0)||b.length-a.length)[0]??null;
}
export function releaseDate(html){
 const dom=parse(html),metadata=[];
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const monthPattern='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
 const english=new RegExp(`^(${monthPattern})\\.?\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})$`,'i');
 const validDate=value=>{
  if(typeof value!=='string')return null;
  const text=normalize(value);let year,month,day;
  const iso=text.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if(iso){[,year,month,day]=iso.map((x,i)=>i?Number(x):x);}
  else{const en=text.match(english);if(!en)return null;year=Number(en[3]);month=months.findIndex(m=>m.startsWith(en[1].toLowerCase().slice(0,3)))+1;day=Number(en[2]);}
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
 };
 const consistent=values=>{const dates=values.map(validDate);return dates.length&&dates.every(Boolean)&&new Set(dates).size===1?dates[0]:null;};
 for(const m of dom.querySelectorAll('meta'))if(/^(article:published_time|datePublished|publication_date|date|pubdate)$/i.test(m.getAttribute('property')??m.getAttribute('name')??''))metadata.push(m.getAttribute('content')??'');
 // Only the primary Article in top-level JSON-LD / @graph / mainEntity is
 // considered. Related articles, citations and recommendation lists are not.
 let primaryArticle;
 const primary=o=>{
  if(!o||typeof o!=='object')return null;
  if(Array.isArray(o)){for(const v of o){const hit=primary(v);if(hit)return hit;}return null;}
  if([o['@type']].flat().some(t=>/^(?:Article|NewsArticle|PressRelease)$/i.test(String(t))))return o;
  return primary(o.mainEntity)??primary(o['@graph']);
 };
 for(const s of dom.querySelectorAll('script[type="application/ld+json"]')){try{primaryArticle??=primary(JSON.parse(s.text));}catch{}}
 if(primaryArticle?.datePublished!==undefined)metadata.push(primaryArticle.datePublished);
 // A conflicting or malformed declared publication date fails closed. Never
 // replace it with a historical agreement date mentioned in the article text.
 if(metadata.length)return consistent(metadata);
 dom.querySelectorAll('script,style,nav,footer,aside,[class*="related"],[class*="recommended"]').forEach(n=>n.remove());
 const content=dom.querySelector('article')??dom.querySelector('main')??dom;
 const dated=[];
 for(const node of content.querySelectorAll('time,[itemprop="datePublished"],[class],[id]')){
  const marker=`${node.getAttribute('class')??''} ${node.getAttribute('id')??''}`;
  if(/modified|updated|event|copyright|expire/i.test(marker))continue;
  const explicit=node.tagName==='TIME'||node.getAttribute('itemprop')==='datePublished'||/(?:^|[\s_-])(?:date|pubdate|published|publication-date|release-date)(?:$|[\s_-])/i.test(marker);
  if(!explicit)continue;
  const value=node.getAttribute('datetime')??node.getAttribute('content')??normalize(node.text).replace(/^(?:Published|Released|Release date|Date)\s*:?\s*/i,'');
  if(validDate(value))dated.push(value);
 }
 if(dated.length)return consistent(dated);
 // Only a location-led dateline near the beginning of the article qualifies.
 // Publishers use both "CITY, State, Date — body" and "City, State—Date".
 // Never search later historical paragraphs for a convenient date.
 const dateline=new RegExp(`^([A-Za-z .,'’&()/-]{2,100}?)(?:[,—–]|--)\\s*(${monthPattern}\\.?\\s+\\d{1,2},?\\s+(?:19|20)\\d{2})(?:\\s*(?:[—–]|--|\\s-\\s)\\s*.*|\\s*)$`,'i');
 const datelines=[];
 let precedingCharacters=0;
 const introductoryBlocks=content.querySelectorAll('p,div').filter(n=>n.tagName==='P'||!n.querySelector('p,div')).filter(n=>normalize(n.text)).slice(0,8);
 for(const node of introductoryBlocks){
  const text=normalize(node.text);if(precedingCharacters>2000)break;precedingCharacters+=text.length;
  const hit=text.match(dateline);if(!hit)continue;
  const words=hit[1].match(/[A-Za-z]+/g)??[];
  if(words.length&&words.length<=12&&words.every(word=>/^[A-Z]/.test(word)))datelines.push(hit[2]);
 }
 return datelines.length?consistent(datelines):null;
}
export function validateRow(r,{universe,domains,source,filing}){
 const reasons=[],from=universe.get(r.from),to=universe.get(r.to);
 if(!from||!to)reasons.push('outside_universe');
 if(r.from===r.to)reasons.push('self_relation');
 if(!['供給・採用元','納入・採用先','提携・出資・技術対応','さらに先の関係','競合'].includes(r.type))reasons.push('invalid_type');
 if(Array.from(r.text_ja??'').length>30||!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(r.text_ja??'')||/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(r.text_ja??''))reasons.push('invalid_japanese');
 let url;try{url=new URL(r.source_url)}catch{reasons.push('invalid_url')}
 if(url?.protocol!=='https:')reasons.push('not_https');
 if(source.error)reasons.push(source.error);
 const sec=url?.hostname==='www.sec.gov'&&url.pathname.startsWith('/Archives/edgar/data/');
 if(sec){if(!filing||!['10-K','10-Q','8-K'].includes(filing.form))reasons.push('sec_filing_not_confirmed');}
 else if(url&&![r.from,r.to].some(id=>(domains[id]?.domains??[]).some(d=>[url.hostname,new URL(source.finalUrl??r.source_url).hostname].every(host=>host===d.host||host?.endsWith('.'+d.host)))))reasons.push('not_party_official_domain');
 if(!sec&&!(/news|press|release|announcement/i.test(url?.pathname??'')||(/^(?:newsroom|ir|investor|investors)\./i.test(url?.hostname??'')&&/^\/(?:20\d{2}[-/]|node\/\d+)/.test(url?.pathname??''))))reasons.push('not_official_release');
 if(!r.evidence_quote||Array.from(r.evidence_quote).length>200)reasons.push('quote_missing_or_over_200');
 else {
  const q=normalize(r.evidence_quote);if(!source.body?.includes(q))reasons.push('quote_not_in_body');
  if(from&&!contains(q,from))reasons.push('quote_missing_from');if(to&&!contains(q,to))reasons.push('quote_missing_to');
 }
 const date=sec?filing?.date:source.date;
 if(!date||date!==r.source_date)reasons.push('publication_date_unverified');
 if(r.type==='競合'){
  if(!sec||filing?.form!=='10-K'||String(from?.cik)!==String(filing?.cik))reasons.push('competition_not_from_10k');
  if(!source.competition?.some(s=>s.includes(normalize(r.evidence_quote??''))))reasons.push('quote_not_in_competition_section');
 }
 return [...new Set(reasons)];
}
export function fetcher(cacheDir,{retryTransient=false}={}){
 const memory=new Map();return async function get(url){
  if(memory.has(url))return memory.get(url);
  const pending=(async()=>{await fs.mkdir(cacheDir,{recursive:true});const file=path.join(cacheDir,createHash('sha256').update(url).digest('hex')+'.json');
   if(!process.argv.includes('--fresh'))try{const saved=JSON.parse(await fs.readFile(file,'utf8'));const retry=saved.error&&(saved.status===429||(saved.error==='sec_contact_missing'&&validContact(process.env.RESEARCH_USER_AGENT))||(retryTransient&&(saved.error==='fetch_unavailable'||saved.status>=500))||process.argv.includes('--retry-failed'));if(!retry){if(saved.html){saved.body=bodyOf(saved.html);saved.competition=competitionSections(saved.html);saved.date=releaseDate(saved.html,saved.body);}return {...saved,cacheHit:true};}}catch{}
   let result;try{const u=new URL(url);if(u.protocol!=='https:'||/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname))throw Error('non_public_url');
    let next=url,r;const retries=[];for(let hop=0;hop<5;hop++){const check=new URL(next);if(check.protocol!=='https:'||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(check.hostname))throw Error('non_public_redirect');
     const sec=secURL(next),agent=sec?process.env.RESEARCH_USER_AGENT:'TechPhaseEvidenceAudit/3.0';
     if(sec&&!validContact(agent)){result={url,error:'sec_contact_missing',detail:'Set RESEARCH_USER_AGENT to service name and a real contact email; no SEC request sent.'};break;}
     const request=()=>fetch(next,{signal:AbortSignal.timeout(20000),redirect:'manual',headers:{'User-Agent':agent}});
     r=sec?await retry429(()=>pacedRequest(request),{onRetry:item=>retries.push(item)}):await request();
     if(r.status>=300&&r.status<400){next=new URL(r.headers.get('location'),next).href;continue;}break;}
    if(result?.error){await fs.writeFile(file,JSON.stringify(result));return result;}
    const html=await r.text();result=r.ok?{url,finalUrl:next,status:r.status,html,body:bodyOf(html),competition:competitionSections(html),fetchedAt:new Date().toISOString()}:{url,status:r.status,error:'http_'+r.status};
    result.retries=retries;
    if(r.ok){result.date=releaseDate(html,result.body);if(/just a moment|access denied/i.test(result.body.slice(0,300)))result.error='challenge_page';}
   }catch(e){result={url,error:'fetch_unavailable',detail:e.message}}
   await fs.writeFile(file,JSON.stringify(result));return result;
  })();memory.set(url,pending);return pending;
 };
}
export async function filingFor(url,get){
 const m=url.match(/sec\.gov\/Archives\/edgar\/data\/(\d+)\/(\d{18})\//);if(!m)return null;
 const cik=Number(m[1]),acc=m[2].replace(/^(\d{10})(\d{2})(\d{6})$/,'$1-$2-$3');
 const first=await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10,'0')}.json`);if(first.error)return null;
 let data;try{data=JSON.parse(first.html)}catch{return null}
 const check=f=>{const i=f.accessionNumber?.indexOf(acc);return i>=0?{cik,form:f.form[i],date:f.filingDate[i],accession:acc}:null};
 const recent=check(data.filings.recent);if(recent)return recent;
 for(const f of data.filings.files??[]){const res=await get('https://data.sec.gov/submissions/'+f.name);if(!res.error){try{const hit=check(JSON.parse(res.html));if(hit)return hit}catch{}}}return null;
}
