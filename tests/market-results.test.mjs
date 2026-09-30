import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResultBriefs,resultEvents} from '../lib/research/market-results.ts';
import {publicNewsPayload} from '../lib/research/general-news.ts';
import {publicEvent} from '../lib/research/access.ts';
import {evidenceIssues} from '../lib/research/quality.ts';
const brief={id:'777',researchId:'x-result-777',kind:'earnings',ticker:'MU',period:'Q4 2026',
 titleJa:'MU決算：売上$54.23B',titleEn:'MU earnings: revenue $54.23B',
 facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$54.23B'}],
 url:'https://x.com/wallstengine/status/12345',publisher:'Wall St Engine',
 publishedAt:'2026-10-01T00:00:00Z',observedAt:'2026-10-01T00:00:15Z',publicAt:'2026-10-01T00:00:16Z',
 processingMs:1,sourceToDetectionMs:15000,detectionToPublicMs:1000};
test('automatic factual results make bilingual articles without premium leakage',()=>{
 const [event]=resultEvents(parseResultBriefs([{...brief,privateSource:'SECRET'}]));
 assert.deepEqual(evidenceIssues(event),[]);
 assert.equal(event.summary.ja,brief.titleJa);
 assert.equal(event.summary.en,brief.titleEn);
 assert.deepEqual(publicEvent(event).interpretation,{ja:'',en:''});
 assert.equal(JSON.stringify(event).includes('SECRET'),false);
 for(const changes of [{url:'https://x.com/impostor/status/12345'},{facts:[{...brief.facts[0],value:'BUY NOW'}]},{researchId:'editor-secret'},{publicAt:'bad'}])assert.throws(()=>parseResultBriefs([{...brief,...changes}]));
});
test('macro results are not misrepresented as company earnings',()=>{
 assert.equal(resultEvents(parseResultBriefs([{...brief,kind:'economic',ticker:'ECON'}])).length,0);
});

test('the public news consumer accepts result links only with a matching validated result',()=>{
 const update={id:brief.id,researchId:brief.researchId,title:brief.titleEn,translationJa:brief.titleJa,url:brief.url,publisher:brief.publisher,tickers:['MU'],observedAt:brief.observedAt,publishedAt:brief.publishedAt};
 const payload={ok:true,enabled:false,items:[],resultBriefs:[brief],officialUpdates:[update]};
 assert.equal(publicNewsPayload(payload).officialUpdates[0].researchId,brief.researchId);
 assert.throws(()=>publicNewsPayload({...payload,resultBriefs:[]}));
 assert.throws(()=>publicNewsPayload({...payload,officialUpdates:[{...update,url:'https://x.com/tipranks/status/9876'}]}));
});
