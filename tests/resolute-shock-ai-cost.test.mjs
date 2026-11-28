import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {MODEL_PRICES,usageCost,requestCostBound,reserveAiSpend,serializeBudgetedRequest,monthSpend,MAX_REQUEST_BYTES,MAX_OUTPUT_TOKENS} from '../services/resolute-api/ai-budget.mjs';
import {callJsonModel,generate,SUMMARY_INSTRUCTIONS,SUMMARY_INSTRUCTIONS_NO_CAUSE,OUTPUT_SCHEMA_NO_CAUSE} from '../services/resolute-api/risk-job.mjs';
import {buildCandidates,rankStories,mergeRanking,runCandidates,candidatesMailText,budgetLine,summarizeCandidate,SUMMARY_ATTEMPTS,SUMMARY_MODEL,SUMMARY_BACKSTOP,SUMMARY_BACKSTOPS,TRANSLATE_MODEL} from '../services/resolute-api/shock-candidates.mjs';
import {aiCache,loadAiCache,contentKey} from '../services/resolute-api/shock-ai-cache.mjs';
import {estimateShockAiCost,SCENARIOS} from '../services/resolute-api/shock-ai-cost.mjs';
import {parseRiskArticle,SUMMARY_QUESTION} from '../lib/resolute/risk.ts';
import {hash} from '../services/resolute-api/risk-store.mjs';

const RUN=new Date('2026-11-27T21:02:00Z'),DAY='2026-11-28';
const filler='The report described the session in detail, with comments from strategists and traders about the drivers of the move and the sectors involved.';
const row=(title,publishedAt,{lane='market',tickers=[]}={})=>({title,bodyEn:`${title}. ${filler}`,url:`https://news.example/${hash(title).slice(0,16)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
const TITLES=['Stocks slip as tariffs weigh on chipmakers','Treasury yields jump after inflation data','Oil prices surge on supply fears','Fed officials signal rates stay higher','Chip stocks tumble on export curbs'];
const feed=feedOf(TITLES.map((t,i)=>row(t,`2026-11-27T1${i}:00:00.000Z`)));
const draftOf=c=>parseRiskArticle({id:c.id,url:c.url,publishedAt:c.publishedAt,market:{index:'nas100',session:null,reading:null},stars:null,quoteId:null,
 ja:{title:c.title.slice(0,80),source:'Example Wire',content:`Example Wireが報じました。\n${SUMMARY_QUESTION.ja}`,date:'2026年11月27日'},en:{title:c.title.slice(0,80),source:'Example Wire',content:`Reported.\n${SUMMARY_QUESTION.en}`,date:'November 27, 2026'}});
const rankCall=calls=>async({input})=>{calls.push(JSON.parse(input).stories.map(s=>s.title));const st=JSON.parse(input).stories;
 return {market:st.map((s,i)=>({key:s.key,stars:Math.max(1,5-i),reasonJa:'市場全体に関わるニュース',reasonEn:'Market-wide news.'})),company:[]};};
const withEnv=async(vars,fn)=>{const saved=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
 try{return await fn();}finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}};

test('budget: nano and mini are the allowed models; cached input at the cached price; a request reserves only what it could cost',()=>{
 assert.deepEqual(Object.keys(MODEL_PRICES).sort(),['gpt-5.4-mini','gpt-5.4-nano']);
 for(const model of ['gpt-5.4-mini','gpt-5.4-nano'])assert.ok(serializeBudgetedRequest({model,max_output_tokens:100,input:'x'}));
 assert.throws(()=>serializeBudgetedRequest({model:'gpt-5.4',max_output_tokens:100,input:'x'}),/AI_REQUEST_OUTSIDE_BUDGET/);
 // 1000 input tokens (800 cached) and 100 output tokens.
 assert.equal(usageCost({input_tokens:1000,output_tokens:100},'gpt-5.4-mini'),0.0012);
 assert.equal(usageCost({input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:800}},'gpt-5.4-mini'),0.0007);
 assert.equal(usageCost({input_tokens:1000,output_tokens:100},'gpt-5.4-nano'),0.0004);
 assert.equal(usageCost(undefined),null);assert.equal(usageCost({input_tokens:-1,output_tokens:1}),null);
 // The bound covers the request's worst case and stays under the old flat 10 cents at the caps.
 const body='x'.repeat(MAX_REQUEST_BYTES-600);
 assert.ok(requestCostBound(body,'gpt-5.4-mini',MAX_OUTPUT_TOKENS)>=usageCost({input_tokens:MAX_REQUEST_BYTES,output_tokens:MAX_OUTPUT_TOKENS},'gpt-5.4-mini'));
 assert.ok(requestCostBound(body,'gpt-5.4-mini',MAX_OUTPUT_TOKENS)<=0.1);
 assert.ok(requestCostBound('x'.repeat(6000),'gpt-5.4-nano',1800)<0.005,'a summary request on nano reserves half a cent at most');
});

test('budget: settlement replaces the reservation, a dearer call is charged the difference, a refused request is given back; the month is read',async()=>{
 const pool=new PGlite(),now=new Date('2026-11-27T21:00:00Z');
 try{
  await pool.exec('CREATE SCHEMA resolute; CREATE TABLE resolute.risk_budget(month text PRIMARY KEY,reserved_usd numeric(8,4) NOT NULL CHECK(reserved_usd>=0))');
  const used=async()=>Number((await pool.query('SELECT reserved_usd FROM resolute.risk_budget')).rows[0].reserved_usd);
  const a=await reserveAiSpend(pool,now,{limit:2,reserve:0.01,model:'gpt-5.4-nano'});assert.equal(await used(),0.01);
  await a({input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:1000}});assert.equal(await used(),0.0002);
  const b=await reserveAiSpend(pool,now,{limit:2,reserve:0.001});await b({input_tokens:2000,output_tokens:1000});assert.equal(await used(),0.0062,'charged what it cost');
  const c=await reserveAiSpend(pool,now,{limit:2,reserve:0.05});await c.release();await c({input_tokens:1,output_tokens:1});assert.equal(await used(),0.0062);
  const d=await reserveAiSpend(pool,now,{limit:2,reserve:0.05});await d(undefined);assert.equal(await used(),0.0562,'an unknown outcome keeps its reservation');
  assert.deepEqual(await monthSpend(pool,now,{limit:2}),{used:0.0562,limit:2});
  assert.equal(await monthSpend({query:async()=>{throw Error('db');}},now,{limit:2}),null);
  await withEnv({RESOLUTE_AI_MONTHLY_LIMIT_USD:'2'},async()=>assert.deepEqual(await monthSpend(pool,now),{used:0.0562,limit:2}));
 }finally{await pool.close();}
});

test('model call: the model and prompt cache key are sent; a refused request (404) gives the reservation back, a server error keeps it',async()=>{
 const queries=[],pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:[{reserved_usd:0.01}]};}};
 await withEnv({RESOLUTE_AI_MONTHLY_LIMIT_USD:'2',RESOLUTE_OPENAI_API_KEY:'synthetic'},async()=>{
  let sent;
  const ok=async(_u,init)=>{sent=JSON.parse(init.body);return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:5},output:[{content:[{type:'output_text',text:'{"a":1}'}]}]});};
  assert.deepEqual(await callJsonModel({input:'x',instructions:'y',name:'resolute_titles_ja',schema:{type:'object'},pool,now:RUN,fetcher:ok,model:'gpt-5.4-nano'}),{a:1});
  assert.equal(sent.model,'gpt-5.4-nano');assert.equal(sent.prompt_cache_key,'resolute_titles_ja');assert.equal(sent.store,false);
  const reserved=queries[0].args[1];assert.ok(reserved>0&&reserved<0.01,'the nano request reserves its own bound');
  queries.length=0;
  await assert.rejects(callJsonModel({input:'x',instructions:'y',name:'n',schema:{type:'object'},pool,now:RUN,fetcher:async()=>new Response('no',{status:404}),model:'gpt-5.4-nano'}),e=>e.message==='MODEL_UNAVAILABLE'&&e.status===404);
  assert.equal(queries.length,2);assert.match(queries[1].sql,/reserved_usd-\$2/);assert.equal(queries[1].args[1],queries[0].args[1],'given back in full');
  queries.length=0;
  await assert.rejects(callJsonModel({input:'x',instructions:'y',name:'n',schema:{type:'object'},pool,now:RUN,fetcher:async()=>new Response('no',{status:500})}),/MODEL_UNAVAILABLE/);
  assert.equal(queries.length,1,'a server error keeps the reservation');
 });
});

test('summaries: nano writes first; mini writes again only when nano fails the checks, at most twice a run; nano refused → mini for the run',async()=>{
 assert.equal(SUMMARY_MODEL,'gpt-5.4-nano');assert.equal(SUMMARY_BACKSTOP,'gpt-5.4-mini');assert.equal(SUMMARY_BACKSTOPS,2);assert.equal(TRANSLATE_MODEL,'gpt-5.4-nano');
 assert.ok(SUMMARY_INSTRUCTIONS.includes('cause: classify')&&!SUMMARY_INSTRUCTIONS_NO_CAUSE.includes('cause: classify'));
 assert.ok(SUMMARY_INSTRUCTIONS.startsWith(SUMMARY_INSTRUCTIONS_NO_CAUSE.slice(0,-'No markdown.'.length)),'the same rules, without the cause');
 assert.deepEqual(OUTPUT_SCHEMA_NO_CAUSE.required,['publishable','ja','en']);
 const c={id:'b'.repeat(64),url:'https://news.example/b',title:'Chip stocks tumble on export curbs',body:'Chip stocks tumbled after new export curbs were announced. '+'More detail. '.repeat(600),publishedAt:'2026-11-27T15:00:00.000Z',source:'report',tickers:[]};
 const good={publishable:true,ja:{title:'輸出規制で半導体株が急落',source:'Example Wire',content:'新たな輸出規制の発表を受けて、半導体株が急落しました。',date:'2026年11月27日'},en:{title:'Chip stocks tumble on export curbs',source:'Example Wire',content:'Chip stocks tumbled after new export curbs were announced.',date:'November 27, 2026'}};
 const pool={query:async()=>({rows:[{reserved_usd:0.01}]})};
 await withEnv({RESOLUTE_AI_MONTHLY_LIMIT_USD:'2',RESOLUTE_OPENAI_API_KEY:'synthetic'},async()=>{
  const fake=answer=>{const sent=[];const f=async(_u,init)=>{const b=JSON.parse(init.body);sent.push(b);const r=answer(b);if(typeof r==='number')return new Response('x',{status:r});
   return Response.json({status:'completed',usage:{input_tokens:900,output_tokens:280},output:[{content:[{type:'output_text',text:JSON.stringify(r)}]}]});};f.sent=sent;return f;};
  // nano's summary passes: one nano call, no cause, the text cut to SUMMARY_BODY_CHARS.
  let f=fake(()=>good),run={backstops:2};
  assert.ok(await summarizeCandidate(c,pool,RUN,f,{why:{},log:()=>{},run}));
  assert.deepEqual(f.sent.map(b=>b.model),['gpt-5.4-nano']);assert.equal(f.sent[0].instructions,SUMMARY_INSTRUCTIONS_NO_CAUSE);
  assert.ok(JSON.parse(f.sent[0].input).body.length<=4000);assert.equal(run.backstops,2);
  // nano says not publishable: mini decides (one backstop used).
  f=fake(b=>b.model==='gpt-5.4-nano'?{...good,publishable:false}:good);
  assert.ok(await summarizeCandidate(c,pool,RUN,f,{why:{},log:()=>{},run}));
  assert.deepEqual(f.sent.map(b=>b.model),['gpt-5.4-nano','gpt-5.4-mini']);assert.equal(run.backstops,1);
  // A new number from nano: nano's own retry first, then mini.
  f=fake(b=>b.model==='gpt-5.4-nano'?{...good,ja:{...good.ja,content:'半導体株が12%急落しました。'}}:good);
  assert.ok(await summarizeCandidate(c,pool,RUN,f,{why:{},log:()=>{},run}));
  assert.deepEqual(f.sent.map(b=>b.model),['gpt-5.4-nano','gpt-5.4-nano','gpt-5.4-mini']);assert.equal(run.backstops,0);
  // No backstop left: withheld with nano's reason, no mini call.
  f=fake(b=>b.model==='gpt-5.4-nano'?{...good,publishable:false}:good);const why={},lines=[];
  assert.equal(await summarizeCandidate(c,pool,RUN,f,{why,log:l=>lines.push(l),run}),null);
  assert.deepEqual(f.sent.map(b=>b.model),['gpt-5.4-nano']);assert.equal(why.reason,'not-publishable');assert.match(lines[0],/not-publishable/);
  // nano refused outright (not offered to the key): mini for this and every later story of the run, backstops untouched.
  f=fake(b=>b.model==='gpt-5.4-nano'?404:good);run={backstops:0};
  assert.ok(await summarizeCandidate(c,pool,RUN,f,{why:{},log:()=>{},run}));assert.equal(run.primaryDown,true);
  assert.ok(await summarizeCandidate(c,pool,RUN,f,{why:{},log:()=>{},run}));
  assert.deepEqual(f.sent.map(b=>b.model),['gpt-5.4-nano','gpt-5.4-mini','gpt-5.4-mini']);
  // The legacy daily review keeps its single model and the cause.
  f=fake(()=>({...good,cause:{kind:'unclear',ja:'',en:''}}));
  assert.ok(await generate(c,pool,RUN,f,{why:{},log:()=>{}}));assert.deepEqual(f.sent.map(b=>[b.model,b.instructions===SUMMARY_INSTRUCTIONS]),[['gpt-5.4-mini',true]]);
 });
 assert.equal(SUMMARY_ATTEMPTS,20);
});

test('ranking: new stories are ranked alone and merged into the day\'s cached ranking before the first lower ★',()=>{
 const p=(key,stars)=>({key,stars,reason:{ja:'x',en:'x'}});
 const merged=mergeRanking({market:[p('s1',5),p('s2',3),p('s3',2)],company:[p('s4',4)]},{market:[p('s5',4),p('s6',4),p('s7',1)],company:[p('s8',2)]});
 assert.deepEqual(merged.market.map(x=>x.key),['s1','s5','s6','s2','s3','s7']);
 assert.deepEqual(merged.company.map(x=>x.key),['s4','s8']);
 assert.ok(merged.market.every(x=>!('old' in x)));
});

test('cache: a second run pays for nothing already done; a new article is the only one ranked and summarised',async()=>{
 const cache=aiCache({day:DAY}),rankCalls=[],summarized=[];
 const rank=args=>rankStories({...args,call:rankCall(rankCalls)});
 const summarize=async(c,_p,_n,_f,{why})=>{summarized.push(c.title);if(c.title.startsWith('Oil')){why.reason='not-publishable';return null;}return draftOf(c);};
 const translated=[],translate=async({titles})=>{translated.push(...titles);return titles.map(()=>'原油価格が上昇');};
 const first=await buildCandidates({feed,now:RUN,rank,summarize,translate,cache,log:()=>{}});
 assert.equal(rankCalls.length,1);assert.equal(summarized.length,5);assert.deepEqual(translated,['Oil prices surge on supply fears']);
 assert.equal(first.diagnostics.ai.summariesPaid,5);
 // 06:30 / 08:20 / a retry: the same stories cost nothing.
 const again=await buildCandidates({feed,now:new Date(RUN.getTime()+30*60000),rank,summarize,translate,cache,log:()=>{}});
 assert.equal(rankCalls.length,1);assert.equal(summarized.length,5);assert.equal(translated.length,1);
 assert.deepEqual(again.candidates.map(c=>[c.id,c.rank,c.suggested.stars,!!c.withheld]),first.candidates.map(c=>[c.id,c.rank,c.suggested.stars,!!c.withheld]));
 assert.equal(again.diagnostics.rank.cached,5);assert.equal(again.diagnostics.ai.summariesCached,5);assert.equal(again.withheld[0].titleJa,'原油価格が上昇');
 // One new story: only it is ranked (merged by ★) and summarised.
 const more=feedOf([...TITLES.map((t,i)=>row(t,`2026-11-27T1${i}:00:00.000Z`)),row('Nasdaq plunges as recession fears grow','2026-11-27T20:30:00.000Z')]);
 const third=await buildCandidates({feed:more,now:new Date(RUN.getTime()+60*60000),rank,summarize,translate,cache,log:()=>{}});
 assert.deepEqual(rankCalls[1],['Nasdaq plunges as recession fears grow']);assert.deepEqual(summarized.slice(5),['Nasdaq plunges as recession fears grow']);
 assert.ok(third.candidates.some(c=>c.source.title.startsWith('Nasdaq')));
 // A changed text is a new article for the cache.
 const c0={id:'c'.repeat(64),title:'A',body:'one'};cache.put('summary',c0,{withheld:'shape'});
 assert.equal(cache.get('summary',{...c0,body:'two'}),undefined);assert.deepEqual(cache.get('summary',c0),{withheld:'shape'});
 assert.equal(contentKey(c0).length,16);
});

test('migration 031: the cache is stored with the day, survives a failed 06:00 run, and the 06:30 run only pays for what is new',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:dump});
 try{
  for(const f of ['001_entitlements.sql','009_risk.sql','030_shock_candidates.sql','031_shock_ai_cache.sql'])await db.exec(await readFile(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
  const rankCalls=[],summarized=[];let failAt=3;
  const options={rank:args=>rankStories({...args,call:rankCall(rankCalls)}),translate:async({titles})=>titles.map(()=>null),line:async()=>null,
   summarize:async c=>{summarized.push(c.title);if(summarized.length===failAt)throw Error('MODEL_UNAVAILABLE');return draftOf(c);},mail:async()=>({state:'sent'})};
  await assert.rejects(runCandidates({pool:db,readFeed:async()=>feed,now:RUN,...options}),e=>e.code==='MODEL_UNAVAILABLE');
  assert.equal(summarized.length,3);
  const stored=(await db.query(`SELECT state,ai_cache FROM resolute.shock_candidates WHERE day='${DAY}'`)).rows[0];
  assert.equal(stored.state,'failed');assert.equal(Object.keys(stored.ai_cache).filter(k=>k.startsWith('summary:')).length,2,'the 2 paid summaries are kept');
  assert.equal(Object.keys(stored.ai_cache).filter(k=>k.startsWith('rank:')).length,5);
  failAt=0;
  const r=await runCandidates({pool:db,readFeed:async()=>feed,now:new Date(RUN.getTime()+28*60000),...options});
  assert.equal(r.state,'ready');assert.equal(rankCalls.length,1,'the ranking is not paid again');
  assert.equal(summarized.length,6,'only the 3 summaries not done before');
  assert.equal(r.diagnostics.ai.summariesCached,2);
  // The next day reads the previous days' summaries (an article still in the window is not summarised again), but ranks anew.
  const next=await loadAiCache(db,'2026-11-29'),story={id:hash(feed.reportUpdates[0].url),title:feed.reportUpdates[0].title,body:`${feed.reportUpdates[0].title}. ${filler}`};
  assert.ok(next.get('summary',story));assert.equal(next.get('rank',story),undefined);
  // Without the column (migration not applied) the run works, with a one-run cache.
  const none=await loadAiCache({query:async()=>{throw Error('column "ai_cache" does not exist');}},DAY);
  none.put('title',story,'x');await none.flush();assert.equal(none.get('title',story),'x');
 }finally{await db.close();}
});

test('owner mail: one plain Japanese line once the month\'s AI spend reaches 80% of the limit',async()=>{
 assert.equal(budgetLine({used:1.59,limit:2}),null);assert.equal(budgetLine(null),null);
 assert.equal(budgetLine({used:1.6,limit:2}),'※ 今月のAI費用が上限の80%になりました（1.60ドル／上限2.00ドル）。上限に達すると、月末までAIによる並べ替え・要約・リゼルの一言が止まります。');
 assert.match(budgetLine({used:2.4,limit:2}),/上限の100%/);
 const text=candidatesMailText({day:DAY,candidates:[],planned:[],budget:{used:1.7,limit:2}});
 assert.equal(text.split('\n')[2].startsWith('※ 今月のAI費用が上限の85%'),true);
 assert.ok(!candidatesMailText({day:DAY,candidates:[],planned:[],budget:{used:0.4,limit:2}}).includes('AI費用'));
 // The candidate run reads the month's spend and passes it to the mail.
 const sent=[],pool={query:async sql=>({rows:sql.includes('RETURNING day')?[{day:DAY}]:sql.includes('risk_budget')&&sql.startsWith('SELECT')?[{reserved_usd:'1.65'}]:[]})};
 await withEnv({RESOLUTE_AI_MONTHLY_LIMIT_USD:'2'},()=>runCandidates({pool,readFeed:async()=>feedOf([]),now:RUN,mail:async x=>{sent.push(x);return {state:'sent'};},line:async()=>null}));
 assert.deepEqual(sent[0].budget,{used:1.65,limit:2});assert.match(candidatesMailText(sent[0]),/上限の82%/);
});

test('cost: a usual month is under $1.20 and even a busy-every-day month stays under the $2 limit',()=>{
 const typical=estimateShockAiCost(SCENARIOS.typical),worst=estimateShockAiCost(SCENARIOS.worst);
 assert.ok(typical.month<=1.2,`typical ${typical.month}`);assert.ok(worst.month<2,`worst ${worst.month}`);
 assert.ok(worst.parts.summaries<0.03,'nano summaries');
});
