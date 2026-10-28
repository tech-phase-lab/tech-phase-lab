// Source-first collection must establish access before processing any batch.
// This check does not modify the runtime relationship table.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetcher} from './evidence.mjs';
import {stopReasons} from './batch-policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const get=fetcher(path.resolve(root,'../chain-source-preflight-cache'));
const issuers=[
 ['BE',1664703,'https://www.bloomenergy.com/news/'],
 ['NVDA',1045810,'https://nvidianews.nvidia.com/news'],
 ['NBIS',1513845,'https://nebius.com/newsroom'],
 ['ORCL',1341439,'https://www.oracle.com/news/'],
 ['MU',723125,'https://investors.micron.com/latest-news'],
];
const checks=[];
for(const [ticker,cik,newsroom] of issuers){
 const url=`https://data.sec.gov/submissions/CIK${String(cik).padStart(10,'0')}.json`;
 for(const [kind,source_url] of [['newsroom',newsroom],['submissions',url]]){
  const source=await get(source_url);
  const result={ticker,kind,source_url,status:source.status??null,error:source.error??null};
  if(!source.error&&kind==='submissions'){
   try{
    const data=JSON.parse(source.html),recent=data.filings.recent;
    result.latest10K=recent.form.map((form,i)=>({form,date:recent.filingDate[i],accession:recent.accessionNumber[i],document:recent.primaryDocument[i]})).find(x=>x.form==='10-K')??null;
    result.recent8K=recent.form.filter((form,i)=>form==='8-K'&&recent.filingDate[i]>='2024-10-18'&&recent.filingDate[i]<='2026-10-18').length;
    result.historicalFiles=data.filings.files??[];
   }catch{result.error='invalid_submissions';}
  }
  checks.push(result);
 }
}
const reasons=stopReasons({checks});
const report={asOf:'2026-10-18',windowStart:'2024-10-18',scope:'access preflight only; not complete 24-month discovery',checks,skipped:checks.filter(c=>c.error),stopReasons:reasons,stop:reasons.length>0};
const output=path.resolve(root,'../../outputs/v3');await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'source-preflight.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.stop)process.exitCode=2;
