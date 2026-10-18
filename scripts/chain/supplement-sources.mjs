// Reconcile previously fetched official articles into the source ledger only.
// No network requests, relationship generation, or runtime-data writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bodyOf,releaseDate,contains} from './evidence.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.resolve(base,'../../outputs/v4'),cache=path.resolve(base,'../chain-source-cache');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const preflight=await read(path.join(out,'source-preflight.json'));
const documents=await read(path.join(out,'source-documents.json'));
const domains=await read(path.join(base,'lib/research/company_domains.json'));
const fixed=await read(path.join(base,'lib/research/chain_universe.json'));
const companies=new Map(fixed.companies.map(c=>[c.id,c]));
const explicit=[
 ['BE','https://www.bloomenergy.com/news/bloom-energy-and-oracle-expand-strategic-partnership-to-deploy-up-to-2.8-gw-to-accelerate-ai-infrastructure-build-out/'],
 ['NBIS','https://nebius.com/newsroom/nebius-and-bloom-energy-partner-to-power-ai-infrastructure-build-out'],
 ['BE','https://www.bloomenergy.com/news/brookfield-and-bloom-energy-announce-5-billion-strategic-ai-infrastructure-partnership/'],
 ['ORCL','https://www.oracle.com/apac/news/announcement/oracle-and-aws-deepen-strategic-collaboration-as-enterprise-adoption-of-oracle-ai-database-at-aws-accelerates-2026-08-13/'],
];
const checks=new Map(preflight.checks.map(c=>[c.source_url,c]));
const targets=new Map(preflight.checks.filter(c=>c.kind==='newsroom_article'&&!c.error).map(c=>[c.source_url,c.ticker]));
for(const [ticker,url] of explicit)targets.set(url,ticker);
const ledger=new Map(documents.map(d=>[d.issuer+'|'+d.url,d]));
const added=[],rejected=[],reasonCounts={};
for(const [url,ticker] of targets){
 let source;try{source=await read(path.join(cache,createHash('sha256').update(url).digest('hex')+'.json'))}catch{source={error:'cache_missing'};}
 const reasons=[];let issuer=ticker,date=null,body='';
 const u=new URL(url),final=new URL(source.finalUrl??url);
 if(source.error||!source.html||source.status<200||source.status>=300)reasons.push(source.error??'cached_source_not_successful');
 else{
  body=bodyOf(source.html);date=releaseDate(source.html);
  const partyIds=Object.keys(domains).filter(id=>companies.has(id)&&(domains[id].domains??[]).some(d=>[u.hostname,final.hostname].every(h=>h===d.host||h.endsWith('.'+d.host))));
  if(!partyIds.includes(issuer))issuer=partyIds.find(id=>contains(body,companies.get(id)));
  if(!issuer||!partyIds.includes(issuer))reasons.push('official_issuer_domain_unverified');
  else if(!contains(body,companies.get(issuer)))reasons.push('issuer_name_missing_from_body');
  if(u.protocol!=='https:'||final.protocol!=='https:')reasons.push('not_https');
  if(!date)reasons.push('publication_date_unverified');
  else if(date<'2024-10-18'||date>'2026-10-18')reasons.push('outside_24_month_window');
 }
 const check={...(checks.get(url)??{ticker,kind:'official_release_supplement',source_url:url}),status:source.status??null,error:source.error??null,cacheHit:true,source_date:date,source_validation:{eligible:!reasons.length,reasons}};
 checks.set(url,check);
 if(reasons.length){rejected.push({url,issuer:ticker,reasons});for(const reason of reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;continue;}
 const key=issuer+'|'+url;
 if(!ledger.has(key)){
  const entry={url,issuer,status:source.status,date,cacheHit:true,supplemented:true,collection_method:'previously fetched official article; current body/domain/publication-date validation',html_sha256:createHash('sha256').update(source.html).digest('hex')};
  ledger.set(key,entry);added.push(entry);
 }
}
const report={createdAt:new Date().toISOString(),checked:targets.size,added:added.length,rejected:rejected.length,reasonCounts,explicit:explicit.map(([issuer,url])=>({issuer,url,validation:checks.get(url)?.source_validation,date:checks.get(url)?.source_date})),addedDocuments:added,rejectedDocuments:rejected,notes:['Cache-only reconciliation: no new page requests and no access-control bypass.','Three explicitly supplied articles use location-led publication datelines missed by the previous date parser; navigation and archive coverage remain explicitly incomplete.','No quote, relationship, or runtime JSON generated or changed.']};
if(process.argv.includes('--apply')){
 preflight.checks=[...checks.values()];preflight.skipped=preflight.checks.filter(c=>c.error);preflight.supplement={checked:report.checked,added:report.added,report:'source-supplement.json'};
 for(const [name,value] of [['source-documents.json',[...ledger.values()]],['source-preflight.json',preflight],['source-supplement.json',report]])await fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
}
console.log(JSON.stringify({applied:process.argv.includes('--apply'),checked:report.checked,added:report.added,rejected:report.rejected,reasonCounts,explicit:report.explicit}));
