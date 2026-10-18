import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {fetcher} from './evidence.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.resolve(root,'../../outputs/v4');
const report=JSON.parse(await fs.readFile(path.join(out,'source-preflight.json'),'utf8'));
const get=fetcher(path.resolve(root,'../chain-source-cache'),{retryTransient:true});const results=[];
for(const skipped of report.skipped){
 if(!(skipped.error==='fetch_unavailable'||skipped.status===429||skipped.status>=500)){results.push({...skipped,revisit:'not_retried',reason:skipped.error==='sec_contact_missing'?'requires_configured_contact':'denial_or_permanent_failure_no_bypass'});continue;}
 const result=await get(skipped.source_url);results.push({...skipped,revisit:result.error?'still_unavailable':'recovered',retryStatus:result.status??null,retryError:result.error??null});
}
await fs.writeFile(path.join(out,'retry-results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({revisited:results.filter(r=>r.revisit!=='not_retried').length,recovered:results.filter(r=>r.revisit==='recovered').length}));
