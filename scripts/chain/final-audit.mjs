import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomInt} from 'node:crypto';
import {validateRow,bodyOf,competitionSections,releaseDate} from './evidence.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=process.env.CHAIN_OUTPUT_DIR?path.resolve(process.env.CHAIN_OUTPUT_DIR):path.resolve(root,'../../outputs/v4'),data=path.join(root,'lib/research');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));const write=async(n,v)=>fs.writeFile(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const rows=await read(path.join(data,'chain_relations.json')),fixed=await read(path.join(data,'chain_universe.json')),profiles=await read(path.join(data,'company-introductions.data.json')),domains=await read(path.join(data,'company_domains.json'));
const universe=new Map(fixed.companies.map(c=>[c.id,{...c,cik:c.cik??profiles.find(p=>p.tickers.includes(c.id))?.cik}]));
const documents=await read(path.join(out,'source-documents.json')),docByUrl=new Map(documents.map(d=>[d.url,d]));
const rejected=[],valid=[],descriptions=new Set();
for(const row of rows){
 const file=path.resolve(root,'../chain-source-cache',createHash('sha256').update(row.source_url).digest('hex')+'.json');
 let source;try{source=await read(file);if(source.html){source.body=bodyOf(source.html);source.competition=competitionSections(source.html);source.date=releaseDate(source.html,source.body)}}catch{source={error:'source_cache_missing'}}
 const reasons=validateRow(row,{universe,domains,source,filing:docByUrl.get(row.source_url)?.filing});
 const keys=[row.from,row.to].map(id=>id+'|'+row.text_ja);if(keys.some(k=>descriptions.has(k)))reasons.push('duplicate_description');
 if(reasons.length)rejected.push({...row,reasons});else{valid.push(row);keys.forEach(k=>descriptions.add(k))}
}
await fs.writeFile(path.join(data,'chain_relations.json'),JSON.stringify(valid,null,2)+'\n');await write('chain_relations.json',valid);await write('final-audit-rejected.json',rejected);
const reports=await read(path.join(out,'reports.json'));const sources=await read(path.join(out,'source-preflight.json'));
const states=Object.fromEntries(reports.flatMap(r=>r.roots).map(ticker=>[ticker,valid.some(r=>r.from===ticker||r.to===ticker)?'ready':sources.checks.some(c=>c.ticker===ticker&&c.error)?'source_unavailable':'no_verified_relations']));
await fs.writeFile(path.join(data,'chain_status.json'),JSON.stringify(states,null,2)+'\n');
const summary={processedRoots:reports.flatMap(r=>r.roots),relations:valid.length,finalAuditRejected:rejected.length,batches:reports.map(({reasonCounts,byTicker,...r})=>r),highExclusionTickers:reports.flatMap(r=>Object.entries(r.byTicker??{}).filter(([,s])=>s.rejectionRate>0.3).map(([ticker,s])=>({ticker,...s}))),reasons:{},unavailablePages:sources.skipped.length,requiredUserActions:sources.requiredUserActions,publication:'local staging checkout only; production unchanged'};
for(const report of reports)for(const [reason,n] of Object.entries(report.reasonCounts??{}))summary.reasons[reason]=(summary.reasons[reason]??0)+n;
await write('summary.json',summary);
// Distinct source pages and no more than 25 quoted words from any page in the final sample.
const bySource=new Map();for(const row of valid)if(row.evidence_quote.split(/\s+/).length<=25)bySource.set(row.source_url,[...(bySource.get(row.source_url)??[]),row]);
const urls=[...bySource.keys()];for(let i=urls.length-1;i>0;i--){const j=randomInt(i+1);[urls[i],urls[j]]=[urls[j],urls[i]];}
await write('random-five.json',urls.slice(0,5).map(url=>{const items=bySource.get(url);return items[randomInt(items.length)]}));
console.log(JSON.stringify({processedRoots:summary.processedRoots.length,relations:valid.length,finalAuditRejected:rejected.length,unavailablePages:summary.unavailablePages}));
