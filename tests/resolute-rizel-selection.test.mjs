import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {selectRizel,eligibleCopies} from '../lib/resolute/rizel-selection.ts';
import {saveRizelSelection} from '../services/resolute-api/rizel-selection-store.mjs';
import {createRizelRanker} from '../services/resolute-api/rizel-ranker.mjs';
import {reviewScenarioFeed} from '../lib/resolute/review-scenarios.ts';
const entry=(id,kind='reason',group='A')=>({id,kind,group,revision:1,approval:'approved',publication:'withheld',text:'Synthetic '+id,textSha256:'test-hash',english:{text:'Synthetic English '+id,approval:'approved',textSha256:'test-en-hash'}});
const bank=[entry('a1','conclusion'),entry('a2','conclusion'),...['r1','r2','r3','r4'].map(id=>entry(id)),entry('D-policy-01','reason','D'),entry('D-rates-fx-01','reason','D'),entry('D-executive-03','reason','D'),entry('b1','conclusion','B')];
const article={id:'news-1',revision:'v1',stars:2,text:'Test article'};
const rank=async({candidates})=>({conclusions:candidates.filter(e=>e.kind==='conclusion').map(e=>e.id),reasons:candidates.filter(e=>e.kind==='reason').map(e=>e.id)});
const base={bank,article,evidence:[],history:[],rank,now:new Date('2026-10-17T03:00:00Z')};
test('server excludes unverified facts, wrong group and withdrawn copy',()=>{
 const evidence=[{condition:'rates_rose',articleRevision:'v1',source:'test',reference:'record-1',verifiedBy:'editor'}];
 assert.deepEqual(eligibleCopies(bank,article,evidence).map(e=>e.id),['a1','a2','r1','r2','r3','r4']);
 evidence[0].verifiedBy='data';assert.ok(eligibleCopies(bank,article,evidence).some(e=>e.id==='D-rates-fx-01'));
 evidence[0].articleRevision='old';assert.equal(eligibleCopies(bank,article,evidence).length,6);
});
test('verified D priority, exact text and held publication',async()=>{
 const result=await selectRizel({...base,evidence:[{condition:'policy_proposal',articleRevision:'v1',source:'editor-reviewed report',reference:'review-1',verifiedBy:'editor'}]});
 assert.deepEqual(result.ids,['a1','D-policy-01','r1','r2']);assert.equal(result.copy[0].ja,bank[0].text);assert.equal(result.publication,'withheld');assert.equal(result.audit.article.revision,'v1');
});
test('AI cannot inject text, unknown IDs, wrong stars, unknown facts or duplicate reasons',async()=>{
 for(const output of [{conclusions:['b1'],reasons:[]},{conclusions:['a1'],reasons:['D-rates-fx-01']},{conclusions:['a1'],reasons:['r1','r1']},{conclusions:['a1'],reasons:[],text:'generated'}])await assert.rejects(selectRizel({...base,rank:async()=>output}),/INVALID_AI_SELECTION/);
});
test('avoid recent copies, fall back to least recently used when exhausted',async()=>{
 const history=[{id:'a1',usedAt:'2026-10-16T00:00:00Z'},{id:'r1',usedAt:'2026-10-16T00:00:00Z'}];
 assert.deepEqual((await selectRizel({...base,history})).ids,['a2','r2','r3','r4']);
 history.push({id:'a2',usedAt:'2026-10-15T00:00:00Z'});
 assert.equal((await selectRizel({...base,history})).ids[0],'a2');
});
test('no invented reasons when fewer than three are relevant',async()=>{
 const result=await selectRizel({...base,rank:async()=>({conclusions:['a1'],reasons:['r1']})});assert.deepEqual(result.ids,['a1']);
});
test('article revision is idempotent and audit survives a database round trip',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../db/resolute/011_rizel_selections.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/resolute/012_rizel_review.sql',import.meta.url),'utf8'));
 // PGlite has one connection, no competing workers. PostgreSQL uses advisory lock.
 const pool={connect:async()=>({query:(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args),release(){}})};
 try{let calls=0;const input={...base,rank:async x=>{calls++;return rank(x);}};
 const first=await saveRizelSelection(pool,input);const again=await saveRizelSelection(pool,input);assert.deepEqual(first,again);assert.equal(calls,1);
 await saveRizelSelection(pool,{...input,article:{...article,revision:'v2'}});assert.equal(calls,2);
 assert.equal((await db.query('SELECT * FROM resolute_rizel_selections')).rows.length,2);
 }finally{await db.close();}
});
test('AI adapter is dormant without explicit budget authorization',async()=>{
 let called=false;await assert.rejects(createRizelRanker({apiKey:'test',fetchImpl:async()=>{called=true;}})({}),/NOT_ENABLED/);assert.equal(called,false);
});
test('review scenarios preserve news text and never mutate the source',()=>{
 assert.deepEqual(reviewScenarioFeed('high').articles.map(a=>a.stars),[4,5,4]);
 assert.deepEqual(reviewScenarioFeed('low').articles.map(a=>a.stars),[1,2,1]);
 assert.deepEqual(reviewScenarioFeed('medium').articles.map(a=>a.stars),[3,3,3]);
 assert.deepEqual(reviewScenarioFeed('sample').articles.map(a=>a.stars),[3,2,2]);
 assert.equal(reviewScenarioFeed('failed').articles.length,0);assert.equal(reviewScenarioFeed('live'),null);
 assert.deepEqual(reviewScenarioFeed('high').articles.map(a=>a.ja),reviewScenarioFeed('sample').articles.map(a=>a.ja));
});
test('private preview endpoint authenticates before reading bank, and rejects production',async()=>{
 const {build}=await import('esbuild');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');
 const dir=await mkdtemp(join(tmpdir(),'rizel-auth-'));
 try {
  const output=join(dir,'route.mjs');
  const result=await build({entryPoints:[new URL('../app/api/resolute/rizel-preview/route.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'isolated-auth',setup(b){
   b.onResolve({filter:/^@clerk\/nextjs\/server$/},()=>({path:'auth',namespace:'fake'}));
   b.onResolve({filter:/^@\/lib\/membership\/server$/},()=>({path:'configured',namespace:'fake'}));
   b.onResolve({filter:/^@\/lib\/resolute\/review-policy$/},()=>({path:'policy',namespace:'fake'}));
   b.onResolve({filter:/^@\/lib\/resolute\/rizel-private-bank$/},()=>({path:'bank',namespace:'fake'}));
   b.onLoad({filter:/.*/,namespace:'fake'},({path})=>({contents:path==='auth'?'export async function auth(){return {userId:globalThis.__rizelUser}}':path==='configured'?'export const membershipConfigured=()=>true':path==='policy'?"export const canReviewResolute=(user,env)=>user==='test-owner'&&env==='preview'":"export async function readPrivateRizelPreview(){globalThis.__rizelReads++;throw Error('unconfigured')}"}));
  }}]});
  await writeFile(output,result.outputFiles[0].text);const {GET}=await import(pathToFileURL(output));
  const prior=process.env.VERCEL_ENV;globalThis.__rizelReads=0;
  try {
   process.env.VERCEL_ENV='preview';globalThis.__rizelUser=null;assert.equal((await GET(new Request('https://test/api?stars=3'))).status,403);
   globalThis.__rizelUser='member';assert.equal((await GET(new Request('https://test/api?stars=3'))).status,403);
   globalThis.__rizelUser='test-owner';process.env.VERCEL_ENV='production';assert.equal((await GET(new Request('https://test/api?stars=3'))).status,403);assert.equal(globalThis.__rizelReads,0);
   process.env.VERCEL_ENV='preview';assert.equal((await GET(new Request('https://test/api?stars=99'))).status,400);assert.equal(globalThis.__rizelReads,0);
   const r=await GET(new Request('https://test/api?stars=3'));assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(globalThis.__rizelReads,1);
  }finally{if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;delete globalThis.__rizelReads;delete globalThis.__rizelUser;}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('recent D reasons do not repeat while unused fallback reasons remain',async()=>{
 const result=await selectRizel({...base,evidence:[{condition:'policy_proposal',articleRevision:'v1',source:'report',reference:'review',verifiedBy:'editor'}],history:[{id:'D-policy-01',usedAt:'2026-10-16T00:00:00Z'}]});
 assert.deepEqual(result.ids,['a1','r1','r2','r3']);
});
test('layout registry accepts only twelve intact bilingual approved examples',async()=>{
 const {createHash}=await import('node:crypto');const {parsePrivateRizelRegistry,RIZEL_LAYOUT_IDS}=await import('../lib/resolute/rizel-private-registry.ts');
 const entries=RIZEL_LAYOUT_IDS.map(id=>{const e=entry(id,id.includes('conclusion')?'conclusion':'reason',id[0]);e.textSha256=createHash('sha256').update(e.text).digest('hex');e.english.publication='withheld';e.english.textSha256=createHash('sha256').update(e.english.text).digest('hex');return e;});
 assert.equal(parsePrivateRizelRegistry(JSON.stringify({entries}),true).length,12);
 const changed=structuredClone(entries);changed[0].english.text+=' changed';assert.throws(()=>parsePrivateRizelRegistry(JSON.stringify({entries:changed}),true));
 const unapproved=structuredClone(entries);unapproved[0].english.approval='draft';assert.throws(()=>parsePrivateRizelRegistry(JSON.stringify({entries:unapproved}),true));
 const extra=structuredClone(entries);extra[0].id='D-executive-03';assert.throws(()=>parsePrivateRizelRegistry(JSON.stringify({entries:extra}),true));
 assert.throws(()=>parsePrivateRizelRegistry(JSON.stringify({entries:entries.slice(1)}),true));
});

 test('rule count is a hard limit across conclusion and all reasons',async()=>{
 const b=structuredClone(bank);b[0].text='ルールを確認';b.find(x=>x.id==='r1').text='ルールに戻る';
 const result=await selectRizel({...base,bank:b});assert.deepEqual(result.ids,['a1','r2','r3','r4']);assert.equal(result.audit.ruleOccurrences,1);
 b.find(x=>x.id==='r2').text='ルールルール';
 const short=await selectRizel({...base,bank:b});assert.deepEqual(short.ids,['a1']);assert.equal(short.audit.reasonCount,0);
 });

test('known source and unknown personal criteria cannot receive unsupported factual reasons',()=>{
 const b=[entry('A-reason-07'),entry('A-reason-03'),entry('a1','conclusion')];
 assert.deepEqual(eligibleCopies(b,article,[]).map(e=>e.id),['a1']);
 assert.deepEqual(eligibleCopies(b,article,[{condition:'source_unverified',articleRevision:'v1',source:'reviewer',reference:'checked-report',verifiedBy:'editor'}]).map(e=>e.id),['A-reason-07','a1']);
});
