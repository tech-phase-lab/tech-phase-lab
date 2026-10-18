import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {fetcher} from './evidence.mjs';import {discover} from './discover.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.resolve(root,'../../outputs/v4'),data=path.join(root,'lib/research');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const fixed=await read(path.join(data,'chain_universe.json')),profiles=await read(path.join(data,'company-introductions.data.json')),domains=await read(path.join(data,'company_domains.json'));
const universe=new Map(fixed.companies.map(c=>[c.id,{...c,cik:profiles.find(p=>p.tickers.includes(c.id))?.cik}]));
const roots=process.argv.find(a=>a.startsWith('--roots='))?.slice(8).split(',')??['AMZN','BAM'];
const get=fetcher(path.resolve(root,'../chain-source-cache'));
const prior=await read(path.join(out,'source-preflight.json')),documents=await read(path.join(out,'source-documents.json'));
let result=await discover({roots,profiles,universe,domains,get,collectSec:false,includePartners:false});
for(;;){
 prior.checks.push(...result.checks);for(const [ticker,v] of Object.entries(result.coverage))prior.coverage[ticker]={...(prior.coverage[ticker]??{}),...v};
 documents.push(...result.documents.map(({source,...d})=>({...d,status:source.status,date:source.date,cacheHit:source.cacheHit??false})));
 const more=Object.entries(result.coverage).filter(([,c])=>c.newsroom?.hasMore);if(!more.length)break;
 result=await discover({roots:more.map(([id])=>id),profiles,universe,domains,get,collectSec:false,includePartners:false,resume:Object.fromEntries(more.map(([id,c])=>[id,c.newsroom.continuation]))});
}
for(const [ticker,url] of [['AMZN','https://www.amazon.com/ir'],['AMZN','https://ir.aboutamazon.com/contact-us-and-request-documents/default.aspx']]){const p=await get(url);prior.checks.push({ticker,kind:'official_domain_registration',source_url:url,status:p.status??null,error:p.error??null})}
prior.checks=[...new Map(prior.checks.map(c=>[c.source_url,c])).values()];prior.skipped=prior.checks.filter(c=>c.error);
await fs.writeFile(path.join(out,'source-preflight.json'),JSON.stringify(prior,null,2)+'\n');
await fs.writeFile(path.join(out,'source-documents.json'),JSON.stringify([...new Map(documents.map(d=>[d.issuer+'|'+d.url,d])).values()],null,2)+'\n');
console.log(JSON.stringify({extraRoots:roots,sources:documents.length}));
