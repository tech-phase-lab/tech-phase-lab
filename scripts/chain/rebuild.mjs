import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetcher,validateRow,contains} from './evidence.mjs';
import {discover} from './discover.mjs';
import {candidatesFromSource} from './specific.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const data=path.join(base,'lib/research'),out=path.resolve(base,'../../outputs/v4');
await fs.mkdir(out,{recursive:true});
const read=async name=>JSON.parse(await fs.readFile(path.join(data,name),'utf8'));
const write=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const profiles=await read('company-introductions.data.json'),fixed=await read('chain_universe.json'),domains=await read('company_domains.json');
const universe=new Map(fixed.companies.map(c=>[c.id,{...c,cik:profiles.find(p=>p.tickers.includes(c.id))?.cik}]));
const first=['BE','NVDA','NBIS','ORCL','MU'];
const rest=fixed.companies.filter(c=>c.group==='root'&&!first.includes(c.id)).map(c=>c.id);
const batches=process.argv.includes('--all')?[first,...Array.from({length:Math.ceil(rest.length/10)},(_,i)=>rest.slice(i*10,i*10+10))]:[process.argv.find(a=>a.startsWith('--roots='))?.slice(8).split(',')??first];
const get=fetcher(path.resolve(base,'../chain-source-cache'));
const checks=[],coverage={},reports=[],allAccepted=[],states={},documents=new Map(),seen=new Set(),descriptions=new Set();
const proposalCache=new Map();
const revalidate=process.argv.includes('--revalidate');
if(revalidate){const prior=JSON.parse(await fs.readFile(path.join(out,'source-preflight.json'),'utf8'));checks.push(...prior.checks);Object.assign(coverage,prior.coverage);for(const d of JSON.parse(await fs.readFile(path.join(out,'source-documents.json'),'utf8'))){const source=await get(d.url);if(!source.error)documents.set(d.issuer+'|'+d.url,{...d,source});}}
function mergeCoverage(incoming){for(const [ticker,value] of Object.entries(incoming)){const old=coverage[ticker]??{};coverage[ticker]={...old,...value};if(value.newsroom&&old.newsroom)coverage[ticker].newsroom={...value.newsroom,indexPages:old.newsroom.indexPages+value.newsroom.indexPages,articlePages:old.newsroom.articlePages+value.newsroom.articlePages,datedArticles:old.newsroom.datedArticles+value.newsroom.datedArticles};}}
const key=r=>r.type==='提携・出資・技術対応'?['partner',...[r.from,r.to].sort()].join('|'):r.type==='競合'?['competition',r.from,r.to].join('|'):['supply',...(r.type==='供給・採用元'?[r.to,r.from]:[r.from,r.to])].join('|');
for(const [index,roots] of batches.entries()){
 const batch=index+1;
 const checkStart=checks.length;
 let discovery;
 try{discovery=revalidate?{checks:[],coverage:{},documents:[]}:await discover({roots,profiles,universe,domains,get,asOf:'2026-10-18',since:'2024-10-18'});}catch(e){reports.push({batch,roots,error:'discovery_program_error',detail:e.message});await write('reports.json',reports);continue;}
 checks.push(...discovery.checks);mergeCoverage(discovery.coverage);
 for(const d of discovery.documents)documents.set(d.issuer+'|'+d.url,d);
 let more=Object.entries(discovery.coverage).filter(([,c])=>c.newsroom?.hasMore);
 while(more.length){
  const continuation=await discover({roots:more.map(([id])=>id),profiles,universe,domains,get,asOf:'2026-10-18',since:'2024-10-18',collectSec:false,includePartners:false,resume:Object.fromEntries(more.map(([id,c])=>[id,c.newsroom.continuation]))});
  checks.push(...continuation.checks);for(const d of continuation.documents)documents.set(d.issuer+'|'+d.url,d);
  mergeCoverage(continuation.coverage);more=Object.entries(continuation.coverage).filter(([,c])=>c.newsroom?.hasMore);
 }
 const candidates=[];
 // Partner-issued articles are scanned with each batch root as origin too.
 for(const document of documents.values())for(const ticker of new Set([document.issuer,...roots])){
  if(!universe.has(ticker))continue;
  if(!roots.some(t=>contains(document.source.body??'',universe.get(t)))||!contains(document.source.body??'',universe.get(ticker)))continue;
  const proposalKey=document.url+'|'+ticker;
  let result=proposalCache.get(proposalKey);if(!result){result=candidatesFromSource({source:document.source,issuer:universe.get(ticker),universe,filing:document.filing});proposalCache.set(proposalKey,result);}
  for(const row of result)if(roots.includes(row.from)||roots.includes(row.to))candidates.push({row:{...row,source_url:document.url,source_date:document.filing?.date??document.source.date??''},document});
 }
 const unique=[...new Map(candidates.map(c=>[[c.row.from,c.row.to,c.row.type,c.row.evidence_quote,c.row.source_url].join('|'),c])).values()];
 unique.sort((a,b)=>b.row.source_date.localeCompare(a.row.source_date));
 const accepted=[],rejected=[];
 for(const {row,document} of unique){
  const reasons=[...(row.reasons??[]),...validateRow(row,{universe,domains,source:document.source,filing:document.filing})];
  if(!row.text_ja)reasons.push('specific_fact_missing');
  if(seen.has(key(row)))reasons.push('duplicate_relation');
  const descriptionKeys=[row.from,row.to].map(id=>id+'|'+row.text_ja);
  if(descriptionKeys.some(k=>descriptions.has(k)))reasons.push('duplicate_description');
  if(reasons.length)rejected.push({...row,reasons:[...new Set(reasons)]});
  else{seen.add(key(row));descriptionKeys.forEach(k=>descriptions.add(k));const {reasons:_,...clean}=row;accepted.push(clean);allAccepted.push(clean);}
 }
 const reasonCounts={};for(const row of rejected)for(const reason of row.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
 const byTicker=Object.fromEntries(roots.map(t=>{const a=accepted.filter(r=>r.from===t||r.to===t),r=rejected.filter(r=>r.from===t||r.to===t);return [t,{added:a.length,rejected:r.length,rejectionRate:a.length+r.length?r.length/(a.length+r.length):0}]}));
 const batchChecks=[...new Map(checks.slice(checkStart).map(c=>[c.source_url,c])).values()];
 const report={batch,roots,created:unique.length,added:accepted.length,autoCorrected:0,rejected:rejected.length,reasonCounts,byTicker,tickerCountsNote:'incident relations; a row between two roots is counted for both',highExclusion:unique.length>0&&rejected.length/unique.length>0.3,fetches:batchChecks.length,failedFetches:batchChecks.filter(c=>c.error).length,applied:true};
 reports.push(report);await write(`batch-${batch}-added.json`,accepted);await write(`batch-${batch}-rejected.json`,rejected);await write(`batch-${batch}-report.json`,report);
 for(const ticker of roots)states[ticker]=allAccepted.some(r=>r.from===ticker||r.to===ticker)?'ready':checks.some(c=>c.ticker===ticker&&c.error)?'source_unavailable':'no_verified_relations';
 await fs.writeFile(path.join(data,'chain_relations.json'),JSON.stringify(allAccepted,null,2)+'\n');await fs.writeFile(path.join(data,'chain_status.json'),JSON.stringify(states,null,2)+'\n');
 const uniqueChecks=[...new Map(checks.map(c=>[c.source_url,c])).values()];
 await write('source-preflight.json',{asOf:'2026-10-18',checks:uniqueChecks,skipped:uniqueChecks.filter(c=>c.error),coverage,stop:false,requiredUserActions:uniqueChecks.some(c=>c.error==='sec_contact_missing')?['Configure RESEARCH_USER_AGENT with a real contact email; none is configured. All other work continues.']:[]});
 await write('reports.json',reports);console.log(JSON.stringify({batch,roots,created:report.created,added:report.added,rejected:report.rejected}));
}
await write('chain_relations.json',allAccepted);
await write('source-documents.json',[...documents.values()].map(({source,...d})=>({...d,status:source.status,date:source.date,cacheHit:source.cacheHit??false})));
