import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {editionAt,inEdition,editionSession,isRecapHeadline,percentMismatch,latestClosedSession} from '../lib/resolute/risk-edition.ts';
import {sameEvent} from '../lib/resolute/risk-scope.ts';
import {parsePicks,autoPicks,answerOpen,earningsAfterClose,candidateRunTime,isCandidateRun,parseCandidate,rizelIssues,editedPicks,editTarget,editableStory} from '../lib/resolute/shock-picks.ts';
import {parseRiskArticle,parseRiskFeed,isShownStory,SUMMARY_QUESTION} from '../lib/resolute/risk.ts';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';
import {editionIntake,buildCandidates,publishPicks,candidatesMailText,validateRanking,rankInput,writeRizelLine,RIZEL_INSTRUCTIONS,withPriority,runCandidates} from '../services/resolute-api/shock-candidates.mjs';
import {PRIORITY_TOPICS,priorityTopics} from '../lib/resolute/shock-priority.ts';
import {marketClosedNotice,MARKET_CLOSED_NOTICE,US_MARKET_HOLIDAYS,usMarketSession} from '../lib/research/us-market-session.ts';
import {selectDailyCandidates,repeatsTaken} from '../services/resolute-api/rizel-daily-review.mjs';
import {generate,NUMBER_RETRY} from '../services/resolute-api/risk-job.mjs';
import {ownerShockMailText,WITHHELD_REASON_JA} from '../services/resolute-api/shock-owner-mail.mjs';
import {riskRequest,saveOwnerPicks,publicRiskFeed,hash} from '../services/resolute-api/risk-store.mjs';
import {parseDraft,parseDraftInput,ownerDraftAccess} from '../lib/resolute/owner-news.ts';
import {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';

const body=t=>`${t}. The report said the move weighed on technology shares across the session, and investors sold chip stocks after the news broke.`;
const row=(title,publishedAt,{tickers=[],lane='company'}={})=>({title,bodyEn:body(title),url:`https://news.example/${encodeURIComponent(title).slice(0,80)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
// The two S&P headlines of the Nov 27 edition (as shown, Japanese) and their English originals.
const SP_JA=['S&PがNvidiaのAA格付けをCreditWatch negativeに指定','S&P Global、NvidiaをCreditWatch Negativeに指定'];
const SP_EN=['S&P puts Nvidia AA rating on CreditWatch negative','S&P Global places Nvidia on CreditWatch Negative'];
const nov25={'2026-11-25':{nas100:{previousDate:'2026-11-24',changePercent:0.2,typicalPercent:0.8,up:55,down:45,total:100},sox:{previousDate:'2026-11-24',changePercent:-0.4,typicalPercent:2,up:18,down:22,total:40},
 fear:{level:20,previousLevel:20},stocks:{SNDK:{previousDate:'2026-11-24',changePercent:-5.6,typicalPercent:3,intradayPercent:-7.1}}}};

test('A: the edition covers the news since the previous publish run; numbers only from the latest closed session',()=>{
 // Fri Nov 27 08:20 JST (after Thanksgiving): the window starts Thu 08:20 JST = Wed Nov 25 18:20 New York, after Wednesday's close.
 const run=new Date('2026-11-26T23:20:00Z'),e=editionAt(run);
 assert.equal(new Date(e.from).toISOString(),'2026-11-25T23:20:00.000Z');assert.equal(e.session,'2026-11-25');assert.equal(latestClosedSession(run),'2026-11-25');
 // Sandisk's 34% headline (published during Wednesday's session) is not in this edition at all.
 assert.equal(inEdition('2026-11-25T19:00:00.000Z',e),false);
 // A Thanksgiving story qualifies, without numbers (its session, Friday, has not closed).
 assert.equal(inEdition('2026-11-26T15:00:00.000Z',e),true);assert.equal(editionSession('2026-11-26T15:00:00.000Z',e),null);
 assert.equal(inEdition('2026-11-26',e),false,'a date-only story cannot be placed');
 // Thu Nov 26 08:20 JST: Wednesday's intraday story is in, and measured on Wednesday (the session it was published during).
 const wed=editionAt(new Date('2026-11-25T23:20:00Z'));
 assert.equal(inEdition('2026-11-25T19:00:00.000Z',wed),true);assert.equal(editionSession('2026-11-25T19:00:00.000Z',wed),'2026-11-25');
 // The candidate run (06:00 JST) reads what is out so far; the window starts at the same place.
 assert.equal(editionAt(new Date('2026-11-25T21:00:00Z')).from,wed.from);
 // Weekends are editions too: Sunday 08:20 JST covers Saturday's news, numbers from Friday only for Friday's stories.
 const sun=editionAt(new Date('2026-11-28T23:20:00Z'));assert.equal(sun.session,'2026-11-27');
});

test('A: multi-day recaps and a headline % that is not the session\'s move are not that day\'s news',()=>{
 for(const t of ['Sandisk stock drops 34% from its record high','Nvidia shares down 12% this week','Stocks fall for third straight session','Chip stocks slide 8% in five days','AMD has lost 20% since October','半導体株、年初来で30%下落','Nasdaq falls 5% year to date'])assert.ok(isRecapHeadline(t),t);
 for(const t of ['Nasdaq falls 2% as yields jump','Stocks post worst day since April','Nvidia rallies after earnings beat','Sandisk株が34%下落'])assert.ok(!isRecapHeadline(t),t);
 assert.equal(percentMismatch('Sandisk株が34%下落',[-5.6,-7.1]),true);
 assert.equal(percentMismatch('Sandisk falls 6% on memory price cut',[-5.6,-7.1]),false,'within one point of the close');
 assert.equal(percentMismatch('Sandisk falls 7.5%',[-5.6,-7.1]),false,'within one point of the intraday extreme');
 assert.equal(percentMismatch('Sandisk falls 34%',[]),false,'not measured: not checked');
 // In the intake: the Nov 26 edition (Wednesday measured) drops «Sandisk stock drops 34%» (−5.6% that day) and the weekly recap.
 const run=new Date('2026-11-25T23:20:00Z');
 const feed=feedOf([row('Sandisk stock drops 34% after analyst downgrade','2026-11-25T19:00:00.000Z',{tickers:['SNDK']}),row('Sandisk shares slide 6% as memory prices fall','2026-11-25T18:00:00.000Z',{tickers:['SNDK']}),
  row('Chip stocks tumble 9% this week on AI worries','2026-11-25T17:00:00.000Z',{lane:'market'}),row('Stocks slip as Treasury yields jump','2026-11-24T20:00:00.000Z',{lane:'market'})]);
 const {stories,diagnostics}=editionIntake(feed,run,{moves:nov25});
 assert.deepEqual(stories.map(s=>s.title),['Sandisk shares slide 6% as memory prices fall']);
 assert.equal(diagnostics.percentMismatch,1);assert.equal(diagnostics.recap,1);assert.equal(diagnostics.outsideEdition,1);
 assert.equal(stories[0].market.session,'2026-11-25');assert.equal(stories[0].market.reading.company.changePercent,-5.6);
 // The automatic selection uses the same edition window and checks.
 const legacy=selectDailyCandidates(feed,run,{moves:nov25});
 assert.ok(![...legacy.selected,...legacy.reserve].some(c=>/34%|this week|Treasury/.test(c.title)));
 assert.equal(legacy.diagnostics.edition.session,'2026-11-25');
});

test('C: one story per event — the two S&P CreditWatch headlines collapse to one',()=>{
 assert.ok(sameEvent({title:SP_JA[0]},{title:SP_JA[1]}));
 assert.ok(sameEvent({title:SP_EN[0],tickers:['SPGI','NVDA']},{title:SP_EN[1],tickers:['NVDA']}));
 assert.ok(!sameEvent({title:'Nvidia shares fall after earnings beat'},{title:'Nvidia unveils new Blackwell chip'}));
 assert.ok(!sameEvent({title:'Stocks fall as Treasury yields jump'},{title:'Stocks rally after Fed holds rates'}));
 assert.ok(repeatsTaken({title:SP_EN[1],tickers:['NVDA'],publishedAt:'2026-11-25T16:00:00.000Z'},[{title:SP_EN[0],tickers:['SPGI'],publishedAt:'2026-11-25T15:30:00.000Z'}]));
 const run=new Date('2026-11-25T23:20:00Z');
 const {stories,diagnostics}=editionIntake(feedOf([row(SP_EN[0],'2026-11-25T15:30:00.000Z',{tickers:['SPGI','NVDA']}),row(SP_EN[1],'2026-11-25T16:00:00.000Z',{tickers:['NVDA']})]),run);
 assert.equal(stories.length,1);assert.equal(diagnostics.sameEvent,1);
});

const sid=n=>hash('story-'+n);
const copy=(t,c='Example Wireが報じました。')=>({ja:{title:t,source:'Example Wire',content:`${c}\n${SUMMARY_QUESTION.ja}`,date:'2026年11月25日'},en:{title:t,source:'Example Wire',content:`Reported.\n${SUMMARY_QUESTION.en}`,date:'November 25, 2026'}});
const cand=(n,group,rank,stars,title=`Story ${n}`)=>parseCandidate({id:sid(n),url:`https://news.example/${n}`,publishedAt:'2026-11-25T15:00:00.000Z',group,rank,source:{title,tickers:[],publisher:'Example Wire'},
 ...copy(title),market:{index:group==='market'?'nas100':'company',session:null,reading:null},suggested:{stars,reason:{ja:'市場全体に関わる発表です',en:'A market-wide announcement.'},by:'ai'}});

test('owner pick: timing constants, earnings mornings at 06:30, answers until 08:00, publish at 08:20',()=>{
 assert.deepEqual([RISK_POLICY.ownerPicks.candidateRunJst,RISK_POLICY.ownerPicks.candidateRunEarningsJst,RISK_POLICY.ownerPicks.answerUntilJst,RISK_POLICY.ownerPicks.publishRunJst],['06:00','06:30','08:00','08:20']);
 const events=[{kind:'earnings',ticker:'NVDA',startsAt:'2026-11-25T21:20:00Z',afterClose:true},{kind:'earnings',ticker:'MU',startsAt:'2026-11-20T21:30:00Z'},{kind:'economic',startsAt:'2026-11-25T21:00:00Z'}];
 assert.deepEqual(earningsAfterClose('2026-11-26',events),['NVDA']);assert.equal(candidateRunTime('2026-11-26',events),'06:30');assert.equal(candidateRunTime('2026-11-27',events),'06:00');
 assert.equal(isCandidateRun(new Date('2026-11-25T21:00:00Z'),events),false,'06:00 waits on an earnings morning');
 assert.equal(isCandidateRun(new Date('2026-11-25T21:30:00Z'),events),true);
 assert.equal(isCandidateRun(new Date('2026-11-26T21:00:00Z'),events),true);
 assert.equal(isCandidateRun(new Date('2026-11-26T23:00:00Z'),events),false,'not after the 08:00 deadline');
 assert.equal(answerOpen('2026-11-27',new Date('2026-11-26T22:59:00Z')),true);assert.equal(answerOpen('2026-11-27',new Date('2026-11-26T23:00:00Z')),false);
});

test('owner pick: picks are validated; the auto pick takes three with at least two market-wide',()=>{
 const list=[cand(1,'company',1,4),cand(2,'market',1,3),cand(3,'company',2,5),cand(4,'market',2,2),cand(5,'market',3,2)];
 assert.deepEqual(autoPicks(list).map(p=>[p.id,p.stars]),[[sid(2),3],[sid(1),4],[sid(4),2]]);
 assert.deepEqual(autoPicks([cand(1,'company',1,4),cand(3,'company',2,5),cand(2,'market',1,3)]).map(p=>p.id),[sid(2),sid(1),sid(3)]);
 assert.deepEqual(parsePicks([{id:sid(3),stars:5,rizel:{ja:'自分のルールを先に。'}},{id:sid(2),stars:1}],list),[{id:sid(3),stars:5,rizel:{ja:'自分のルールを先に。'}},{id:sid(2),stars:1}]);
 for(const bad of [[],[{id:sid(1),stars:6}],[{id:sid(9),stars:1}],[{id:sid(1),stars:1},{id:sid(1),stars:2}],[1,2,3,4].map(n=>({id:sid(n),stars:1}))])assert.throws(()=>parsePicks(bad,list));
});

test('owner pick: stars from the owner are kept and shown without measured numbers, in the owner\'s order',()=>{
 const base={url:'https://news.example/x',publishedAt:'2026-11-26T15:00:00.000Z',market:{index:'nas100',session:null,reading:null},quoteId:null,...copy('感謝祭の日のニュース')};
 const a=parseRiskArticle({...base,id:sid(1),stars:4,pick:{source:'owner'},rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'}});
 const b=parseRiskArticle({...base,id:sid(2),stars:5,pick:{source:'owner'}});
 assert.equal(a.stars,4);assert.ok(isShownStory(a));
 assert.equal(parseRiskArticle({...base,id:sid(3),stars:4}).stars,null,'without a pick the table still decides');
 assert.deepEqual(parseRiskFeed({state:'ready',date:'2026-11-27',articles:[a,b],quotes:[]}).articles.map(x=>x.stars),[4,5]);
});

const summaryOut=(content='Example Wireは、S&PがNvidiaの格付けを見直し対象にしたと報じました。発表を受けて半導体株が売られたと伝えています。')=>({publishable:true,cause:{kind:'unclear',ja:'',en:''},
 ja:{title:'S&PがNvidiaを格付け見直しの対象に',source:'Example Wire',content,date:'2026年11月25日'},en:{title:'S&P puts Nvidia on watch',source:'Example Wire',content:'Example Wire reported that S&P put Nvidia on watch. Chip stocks were sold after the news.',date:'November 25, 2026'}});
const modelOf=outputs=>{const bodies=[];return {bodies,fetcher:async(_u,init)=>{bodies.push(JSON.parse(init.body));return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{content:[{type:'output_text',text:JSON.stringify(outputs[bodies.length-1])}]}]});}};};
const withModel=async fn=>{const env={key:process.env.RESOLUTE_OPENAI_API_KEY,limit:process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD};process.env.RESOLUTE_OPENAI_API_KEY='test-key';process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD='2';
 try{return await fn();}finally{for(const [k,v] of [['RESOLUTE_OPENAI_API_KEY',env.key],['RESOLUTE_AI_MONTHLY_LIMIT_USD',env.limit]])if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const budget={query:async()=>({rows:[{reserved_usd:0.1}]})};

test('E: a summary with a number not in the source is retried once with the source-numbers instruction; banned wording checks stay',async()=>{
 const candidate={id:sid(7),url:'https://news.example/7',title:SP_EN[0],body:body(SP_EN[0]),publishedAt:'2026-11-25T15:30:00.000Z',source:'report',tickers:['NVDA']};
 await withModel(async()=>{
  let m=modelOf([summaryOut('Nvidiaの株価は12%下落しました。'),summaryOut()]);const why={};
  const article=await generate(candidate,budget,new Date('2026-11-25T23:20:00Z'),m.fetcher,{why,log:()=>{}});
  assert.equal(m.bodies.length,2);assert.ok(m.bodies[1].instructions.endsWith(NUMBER_RETRY));assert.ok(article&&article.ja.content.includes('半導体株が売られた'));
  m=modelOf([summaryOut('Nvidiaの株価は12%下落しました。'),summaryOut('株価は12%下落しました。')]);const why2={};
  assert.equal(await generate(candidate,budget,new Date('2026-11-25T23:20:00Z'),m.fetcher,{why:why2,log:()=>{}}),null);assert.equal(why2.reason,'new-number');assert.equal(m.bodies.length,2);
  m=modelOf([summaryOut('この下げは一時的です。'),summaryOut('この下げは一時的です。')]);const why3={};
  assert.equal(await generate(candidate,budget,new Date('2026-11-25T23:20:00Z'),m.fetcher,{why:why3,log:()=>{}}),null);assert.equal(why3.reason,'banned-wording');
 });
});

test('E/F: owner mail shows each summary under its title and why a summary was withheld, in plain Japanese',()=>{
 const article=parseRiskArticle({id:sid(8),url:'https://news.example/8',publishedAt:'2026-11-25T13:00:00.000Z',stars:2,quoteId:null,
  market:{index:'nas100',session:'2026-11-25',reading:{from:'2026-11-24',nas100:{changePercent:-1.2,multiple:1.5,same:70,total:100},sox:null,fearChange:3}},
  judge:{source:'ai',reason:{ja:'金利の上昇で株式全体が下げた',en:'Rates rose.'}},...copy('米国株が金利上昇で下落','米国債利回りの上昇を受けて、主要な株価指数が下がりました。')});
 const text=ownerShockMailText({day:'2026-11-26',articles:[article],quotes:[],fallback:false,withheld:[{title:SP_EN[1],reason:'not-publishable'},{title:'X',reason:'new-number'}]});
 assert.ok(text.includes('1. 米国株が金利上昇で下落\n要約: 米国債利回りの上昇を受けて、主要な株価指数が下がりました。'));
 assert.ok(text.includes(`・${SP_EN[1]}\n  ${WITHHELD_REASON_JA['not-publishable']}`));
 assert.equal(WITHHELD_REASON_JA['not-publishable'],'要約なし：元の記事の本文が短く、事実だけで書けなかったため');
 assert.ok(text.includes(WITHHELD_REASON_JA['new-number']));
});

test('owner pick: candidates are ranked by the AI (validated), summarised, and mailed with the owner page link',async()=>{
 const run=new Date('2026-11-25T21:00:00Z');
 const feed=feedOf([row('Fed signals slower rate cuts as inflation stays hot','2026-11-25T19:00:00.000Z',{lane:'market'}),row('Apple CEO Tim Cook to step down','2026-11-25T20:00:00.000Z',{tickers:['AAPL']}),
  row('Sandisk shares slide 6% as memory prices fall','2026-11-25T18:00:00.000Z',{tickers:['SNDK']})]);
 const input=rankInput({day:'2026-11-26',stories:editionIntake(feed,run,{moves:nov25}).stories});
 assert.equal(validateRanking({market:[{key:'s1',stars:9,reasonJa:'x',reasonEn:'x'}],company:[]},input),null,'stars 1–5 only');
 assert.equal(validateRanking({market:[{key:'s1',stars:3,reasonJa:'一時的な下げ',reasonEn:'x'}],company:[]},input),null,'banned wording');
 assert.equal(validateRanking({market:[{key:'s1',stars:3,reasonJa:'金利が77%上昇',reasonEn:'x'}],company:[]},input),null,'no invented number');
 const rank=async({stories})=>({by:'ai',attempts:1,ranking:{market:[{key:'s1',stars:4,reason:{ja:'利下げのペースが市場全体に響く',en:'Rate path moves the whole market.'}}],
  company:[{key:`s${stories.findIndex(s=>s.title.startsWith('Apple'))+1}`,stars:4,reason:{ja:'巨大企業の経営トップの交代',en:'A mega-cap CEO exit.'}},{key:`s${stories.findIndex(s=>s.title.startsWith('Sandisk'))+1}`,stars:2,reason:{ja:'メモリー価格の下落',en:'Memory prices fell.'}}]}});
 const summarize=async(c,_p,_n,_f,{why})=>{if(c.title.startsWith('Sandisk')){why.reason='not-publishable';return null;}return parseRiskArticle({id:c.id,url:c.url,publishedAt:c.publishedAt,market:{index:'nas100',session:null,reading:null},stars:null,quoteId:null,...copy(c.title,`${c.title}と報じられました。理由として記事は需要の変化を挙げています。`)});};
 const built=await buildCandidates({feed,now:run,moves:nov25,rank,summarize});
 assert.deepEqual(built.candidates.map(c=>[c.group,c.rank,c.suggested.stars]),[['market',1,4],['company',1,4]]);
 assert.deepEqual(built.withheld,[{title:'Sandisk shares slide 6% as memory prices fall',reason:'not-publishable'}]);
 // The morning mail lists only the 3 the service plans to publish, then the correction link (owner, Nov 27).
 const planned=[{id:built.candidates[0].id,stars:4,rizel:{ja:'まず自分のルールを確かめます。\n見出しより先に、決めた手順を見ます。',en:'Check your own rules first.\nLook at your steps before the headline.',by:'ai'}},{id:built.candidates[1].id,stars:4}];
 const text=candidatesMailText({day:'2026-11-26',candidates:built.candidates,planned,withheld:built.withheld});
 for(const s of ['衝撃度チェッカー 2026-11-26','08:20に、次の2つを公開します。','1. Fed signals','リゼルの一言: まず自分のルールを確かめます。\n  見出しより先に、決めた手順を見ます。','リゼルの一言: なし',`このニュースを直す: https://techphase.app/resolute/news/owner?edit=${built.candidates[0].id}`,`このニュースを直す: https://techphase.app/resolute/news/owner?edit=${built.candidates[1].id}`,'訂正がある場合はこちら（08:00まで）: https://techphase.app/resolute/news/owner','要約なし：元の記事の本文が短く'])assert.ok(text.includes(s),s);
 assert.ok(!text.includes('■'),'the 14 candidates are on the owner page only');assert.ok(!text.includes('・見出し'),'no bullets');
});

test('owner pick: the RIZEL note is one note of 1–3 short sentences, checked (AI) — banned wording rewritten once, else no note',async()=>{
 assert.deepEqual(rizelIssues({ja:'まず自分のルールを確かめます。見出しより先に、決めた手順を見ます。',en:'Check your own rules first. Look at your steps before the headline.'}),[]);
 assert.ok(rizelIssues({ja:'今が買い時です。',en:'Now is a buying opportunity.'}).length);
 assert.ok(rizelIssues({ja:'まず自分のルールを確かめます。今が買い時です。',en:'x'}).length,'every sentence is checked');
 assert.ok(rizelIssues({ja:'3つのルールを確かめます。',en:'Check 3 rules.'}).includes('number'));
 assert.deepEqual(rizelIssues({ja:'あ'.repeat(121),en:'x'}),['shape']);
 assert.ok(RIZEL_INSTRUCTIONS.includes('買い時')&&/no bullets/.test(RIZEL_INSTRUCTIONS));
 const article=parseRiskArticle({id:sid(9),url:'https://news.example/9',publishedAt:'2026-11-25T13:00:00.000Z',stars:3,quoteId:null,market:{index:'nas100',session:null,reading:null},pick:{source:'auto'},...copy('米国株が下落')});
 let calls=0;const call=async()=>(++calls===1?{ja:'今が買い時です。',en:'A buying opportunity.'}:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.'});
 assert.deepEqual(await writeRizelLine({article,stars:3,call}),{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'});
 assert.equal(await writeRizelLine({article,stars:3,call:async()=>({ja:'一時的な下げです。',en:'Temporary.'})}),null);
 // The owner's note: as written, its line breaks kept; English translated line for line (or the Japanese when that fails).
 const {ownerLine}=await import('../services/resolute-api/shock-candidates.mjs');
 assert.deepEqual(await ownerLine({own:{ja:'様子見が一番です。\n買い時を待ちます。'},call:async()=>({lines:['Waiting is best.','I wait for the right time.']})}),
  {ja:'様子見が一番です。\n買い時を待ちます。',en:'Waiting is best.\nI wait for the right time.',by:'owner'});
 assert.deepEqual(await ownerLine({own:{ja:'様子見が一番です。'},call:async()=>{throw Error('x');}}),{ja:'様子見が一番です。',en:'様子見が一番です。',by:'owner'});
});

function memoryPool(row){
 const saved=[],updates=[];
 return {saved,updates,query:async(sql,args)=>{
  if(sql.includes('INSERT INTO resolute.shock_candidates')&&sql.includes('published_at'))return {rows:row?[row]:[]};
  if(sql.includes('INSERT INTO resolute.risk_days')){saved.push(JSON.parse(args[2]));return {rows:[]};}
  updates.push(sql);return {rows:[]};}};
}
test('owner pick: the owner\'s picks are published as answered — order, ★, own RIZEL line as written, own added story',async()=>{
 const now=new Date('2026-11-26T23:20:00Z'),list=[cand(1,'market',1,3),cand(2,'company',1,4)];
 const added={id:'o'+'a'.repeat(20),url:null,publisher:'Bloomberg',ja:{title:'オーナーが見つけたニュース',summary:'画像の内容をまとめました。'},en:{title:'Owner news',summary:'Summary.'},stars:3,addedAt:'2026-11-26T22:00:00.000Z'};
 const pool=memoryPool({state:'ready',candidates:list,added:[added],picks:[{id:sid(2),stars:5,rizel:{ja:'様子見が一番です。',en:'Wait and see.'}},{id:added.id,stars:2},{id:sid(1),stars:1}],picked_at:'2026-11-26T22:30:00.000Z'});
 const lines=[];const result=await publishPicks({pool,readFeed:async()=>{throw Error('not read');},now,line:async({article})=>{lines.push(article.ja.title);return {ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'};}});
 assert.equal(result.source,'owner');assert.equal(result.count,3);
 const day=pool.saved[0].map(parseRiskArticle);
 assert.deepEqual(day.map(a=>[a.ja.title,a.stars,a.pick.source]),[['Story 2',5,'owner'],['オーナーが見つけたニュース',2,'owner'],['Story 1',1,'owner']]);
 // The owner's own line is published exactly as written, with no wording check (owner, Nov 27).
 assert.deepEqual(day[0].rizel,{ja:'様子見が一番です。',en:'Wait and see.',by:'owner'});
 assert.deepEqual(lines,['オーナーが見つけたニュース','Story 1']);
 assert.equal(day[1].ja.source,'Bloomberg');assert.ok(day[1].ja.content.endsWith(SUMMARY_QUESTION.ja));
 // A second run publishes nothing.
 assert.deepEqual(await publishPicks({pool:memoryPool(null),readFeed:async()=>feedOf([]),now}),{state:'already-published',day:'2026-11-27'});
});
test('owner pick: no answer — the service publishes its own three (two market-wide) from all the news, with the suggested ★',async()=>{
 const now=new Date('2026-11-26T23:20:00Z'),pool=memoryPool({state:'ready',candidates:[cand(1,'company',1,4)],added:[],picks:null,picked_at:null});
 const build=async({limits})=>{assert.deepEqual(limits,{market:3,company:3});return {candidates:[cand(1,'company',1,4),cand(2,'market',1,3),cand(3,'market',2,2),cand(4,'company',2,5)]};};
 const result=await publishPicks({pool,readFeed:async()=>feedOf([]),now,build,line:async()=>null});
 assert.equal(result.source,'auto');
 assert.deepEqual(pool.saved[0].map(parseRiskArticle).map(a=>[a.ja.title,a.stars,a.pick.source]),[['Story 2',3,'auto'],['Story 1',4,'auto'],['Story 3',2,'auto']]);
 // Picks saved after the 08:00 deadline are not the owner's answer.
 const late=memoryPool({state:'ready',candidates:[cand(1,'company',1,4),cand(2,'market',1,3)],added:[],picks:[{id:sid(1),stars:1}],picked_at:'2026-11-26T23:05:00.000Z'});
 assert.equal((await publishPicks({pool:late,readFeed:async()=>feedOf([]),now,build:async()=>{throw Error('x');},line:async()=>null})).source,'auto');
});

const req=(body,path='/internal/v1/risk/owner')=>new Request('https://api.example'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('owner only: the pick API, the draft API and their checks refuse every other account',async()=>{
 const pool={query:async()=>{throw Error('must not be read');}};
 for(const user of ['user_member','user_other',null]){
  const r=await riskRequest(req({action:'picks',day:'2026-11-27',baseRevision:0,picks:[{id:sid(1),stars:3}]}),user,async()=>({canReceiveNotifications:true}),pool);
  assert.equal(r.status,403,String(user));
 }
 assert.equal(ownerDraftAccess('user_member'),403);assert.equal(ownerDraftAccess(null),401);
 assert.equal(ownerDraftAccess(OWNER_ACCOUNT_ID),200);assert.equal(ownerDraftAccess(PRODUCTION_OWNER_ACCOUNT_ID),200);
 // Both owner accounts reach the pick API; outside the answer window it is closed.
 const closed=await saveOwnerPicks(pool,{day:'2026-11-27',baseRevision:0,picks:[]},new Date('2026-11-26T23:10:00Z'));assert.equal(closed.status,409);
});
test('owner pick: the answer is saved compare-and-set with added stories; the owner\'s own text is not wording-checked',async()=>{
 const list=[cand(1,'market',1,3)],writes=[];
 const pool={query:async(sql,args)=>{if(sql.startsWith('SELECT candidates'))return {rows:[{candidates:list,revision:2,published_at:null}]};writes.push({sql,args});return {rows:[{revision:3}]};}};
 const added={id:'o'+'b'.repeat(20),url:'https://news.example/own',publisher:null,ja:{title:'自分で追加',summary:'今が買い時です。'},en:{title:'Own',summary:'Own.'},stars:4,addedAt:'2026-11-26T22:00:00.000Z'};
 const r=await saveOwnerPicks(pool,{day:'2026-11-27',baseRevision:2,picks:[{id:added.id,stars:4,rizel:{ja:'買い時かもしれません。'}},{id:sid(1),stars:2}],added:[added]},new Date('2026-11-26T22:30:00Z'));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{revision:3});
 assert.match(writes[0].sql,/revision=\$5 AND published_at IS NULL/);assert.equal(JSON.parse(writes[0].args[1])[0].rizel.ja,'買い時かもしれません。');
 await assert.rejects(saveOwnerPicks(pool,{day:'2026-11-27',baseRevision:2,picks:[{id:sid(9),stars:2}]},new Date('2026-11-26T22:30:00Z')));
});
test('owner pick: the member feed shows the story\'s own RIZEL line through the quotes list',async()=>{
 const base={url:'https://news.example/x',publishedAt:'2026-11-26T15:00:00.000Z',market:{index:'nas100',session:null,reading:null},quoteId:null,...copy('米国株のニュース')};
 const articles=[{...base,id:sid(1),stars:3,pick:{source:'owner'},rizel:{ja:'様子見が一番です。',en:'Wait.',by:'owner'}},{...base,id:sid(2),stars:5,pick:{source:'owner'},rizel:{ja:'今が買い時です。',en:'Buy now.',by:'ai'}}];
 const pool={query:async sql=>sql.includes('risk_control')?{rows:[{enabled:true}]}:sql.includes('risk_days')?{rows:[{state:'ready',articles}]}:{rows:[]}};
 const before=process.env.RESOLUTE_RISK_PUBLISH_APPROVED;process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
 try{const feed=await publicRiskFeed(pool,false,new Date('2026-11-26T23:30:00Z'));
  assert.deepEqual(feed.articles.map(a=>a.stars),[3,5],'the owner\'s order');
  assert.equal(feed.quotes.find(q=>q.id===feed.articles[0].quoteId).ja.title,'様子見が一番です。');
  assert.equal(feed.articles[1].quoteId,null,'an AI line with banned wording is never shown');
 }finally{if(before===undefined)delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;else process.env.RESOLUTE_RISK_PUBLISH_APPROVED=before;}
});
test('owner news: a draft from text keeps to its numbers and flags banned wording; pictures are optional but one input is required',()=>{
 assert.throws(()=>parseDraftInput({images:[],text:''}));assert.throws(()=>parseDraftInput({text:'x',url:'http://insecure.example'}));
 const input=parseDraftInput({text:'Nvidia said revenue rose 12% in the quarter.',url:'https://news.example/n'});
 const ok=parseDraft('{"ja":{"title":"Nvidiaの売上高が12%増加","summary":"Nvidiaは四半期の売上高が12%増えたと発表しました。"},"en":{"title":"Nvidia revenue up 12%","summary":"Nvidia said revenue rose 12%."},"publisher":"Example"}',input);
 assert.deepEqual(ok.issues,[]);assert.equal(ok.draft.publisher,'Example');
 const bad=parseDraft('{"ja":{"title":"Nvidiaの売上高が15%増加","summary":"一時的な増加です。"},"en":{"title":"x","summary":"x"},"publisher":""}',input);
 assert.ok(bad.issues.includes('new-number'));assert.ok(bad.issues.length>=2);
 assert.equal(parseDraft('no json',input),null);
});
test('migration 030 (written, not applied by this change): the answer and the publish claim run against the real table',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:dump});
 try{
  for(const f of ['001_entitlements.sql','009_risk.sql','030_shock_candidates.sql'])await db.exec(await readFile(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
  const list=[cand(1,'market',1,3),cand(2,'company',1,4)];
  await db.query("INSERT INTO resolute.shock_candidates(day,state,candidates) VALUES('2026-11-27','ready',$1::jsonb)",[JSON.stringify(list)]);
  assert.equal((await saveOwnerPicks(db,{day:'2026-11-27',baseRevision:0,picks:[{id:sid(2),stars:5}]},new Date('2026-11-26T22:30:00Z'))).status,200);
  assert.equal((await saveOwnerPicks(db,{day:'2026-11-27',baseRevision:0,picks:[{id:sid(1),stars:5}]},new Date('2026-11-26T22:31:00Z'))).status,409,'stale revision');
  const result=await publishPicks({pool:db,readFeed:async()=>feedOf([]),now:new Date('2026-11-26T23:20:00Z'),line:async()=>null});
  assert.deepEqual([result.state,result.source,result.count],['ready','owner',1]);
  const day=(await db.query("SELECT articles FROM resolute.risk_days WHERE day='2026-11-27'")).rows[0].articles.map(parseRiskArticle);
  assert.deepEqual(day.map(a=>[a.ja.title,a.stars]),[['Story 2',5]]);
  assert.equal((await saveOwnerPicks(db,{day:'2026-11-27',baseRevision:1,picks:[{id:sid(1),stars:5}]},new Date('2026-11-26T22:59:00Z'))).status,409,'published: closed');
 }finally{await db.close();}
});

test('must-capture topics: every listed topic is recognised, never dropped by the screens, and ranked first (market-wide first)',()=>{
 const samples={crash:['Nasdaq plunges as AI stocks crash','日経平均が暴落'],recession:['Recession fears grip Wall Street','世界恐慌以来の下げ'],downgrade:['S&P puts Nvidia on CreditWatch negative','Moody\'s downgrades Intel'],
  resign:['Apple CEO Tim Cook to step down','Intel CFO resigns','インテルCEOが辞任'],tariff:['Trump announces new chip tariffs','China slaps duties on U.S. goods'],retaliation:['Beijing vows retaliation','EU prepares countermeasures'],
  hormuz:['Tankers halt in Strait of Hormuz','ホルムズ海峡で緊張'],rates:['Fed holds rates steady','Treasury yields jump','日銀が利上げ'],oil:['Oil prices jump','Brent crude tops $90','OPEC+ cuts output']};
 assert.deepEqual(PRIORITY_TOPICS.map(t=>t.key),Object.keys(samples));
 for(const [key,list] of Object.entries(samples))for(const t of list)assert.ok(priorityTopics(t).some(x=>x.key===key),`${key}: ${t}`);
 for(const t of ['Nvidia unveils new chip','Apple exits car project','Microsoft opens new office'])assert.deepEqual(priorityTopics(t).map(x=>x.key),[],t);
 // Neutral wording, no downside word, a bare price move, a short text: still in (the other stories need the old screens).
 const run=new Date('2026-11-25T23:20:00Z');
 const feed=feedOf([{...row('Oil prices rise on OPEC+ supply talk','2026-11-25T18:00:00.000Z',{lane:'market'}),sentiment:undefined,bodyEn:'OPEC+ met.'},
  {...row('Apple CEO Tim Cook to step down','2026-11-25T19:00:00.000Z',{tickers:['AAPL']}),sentiment:undefined},
  {...row('Nvidia plunges 8% in premarket','2026-11-25T13:00:00.000Z',{tickers:['NVDA']}),sentiment:undefined},
  ...Array.from({length:30},(_,i)=>row(`Stocks fall as worries spread ${i}`.replace(/\d+$/,String.fromCharCode(97+i%26)+i),'2026-11-25T17:00:00.000Z',{lane:'market'}))]);
 const {stories}=editionIntake(feed,run);
 const titles=stories.map(s=>s.title);
 for(const t of ['Oil prices rise on OPEC+ supply talk','Apple CEO Tim Cook to step down','Nvidia plunges 8% in premarket'])assert.ok(titles.includes(t),t);
 assert.equal(stories.filter(s=>s.group==='market')[0].title,'Oil prices rise on OPEC+ supply talk','priority first in its group');
 // After the AI: a priority story it left out is put back at the top of its list; a priority story it ranked low moves up.
 const st=[{title:'Fed holds rates steady',group:'market'},{title:'Stocks drift',group:'market'},{title:'Apple CEO Tim Cook to step down',group:'company'},{title:'Acme wins contract',group:'company'}];
 const r=withPriority({market:[{key:'s2',stars:2,reason:{ja:'x',en:'x'}}],company:[{key:'s4',stars:3,reason:{ja:'x',en:'x'}},{key:'s3',stars:5,reason:{ja:'y',en:'y'}}]},st);
 assert.deepEqual(r.market.map(p=>p.key),['s1','s2']);assert.equal(r.market[0].reason.ja,'重要な話題（金利）のため候補に入れました');
 assert.deepEqual(r.company.map(p=>[p.key,p.stars]),[['s3',5],['s4',3]]);
});
test('candidate run: the 3 planned stories are chosen, stored and mailed at 06:00; published exactly as mailed when the owner does nothing',async()=>{
 const now=new Date('2026-11-25T21:00:00Z'),sent=[],writes=[];
 const pool={query:async(sql,args)=>{writes.push({sql,args});return {rows:sql.includes('RETURNING day')?[{day:'2026-11-26'}]:[]};}};
 const list=[cand(1,'company',1,4),cand(2,'market',1,3),cand(3,'market',2,2),cand(4,'company',2,5)];
 const r=await runCandidates({pool,readFeed:async()=>feedOf([]),now,mail:async x=>{sent.push(x);return {state:'sent'};},rank:async()=>({by:'ai',attempts:1,ranking:{market:[],company:[]}}),
  line:async({stars})=>stars===2?null:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'}});
 assert.equal(r.state,'ready');
 // With no stories the plan is empty; with candidates it is the auto pick (2 market-wide first, then the best company story).
 assert.deepEqual(sent[0].planned,[]);
 const {planPicks}=await import('../services/resolute-api/shock-candidates.mjs');
 const planned=await planPicks({candidates:list,line:async({stars})=>stars===2?null:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'}});
 assert.deepEqual(planned.map(p=>[p.id,p.stars,!!p.rizel]),[[sid(2),3,true],[sid(1),4,true],[sid(3),2,false]]);
 const store=memoryPool({state:'ready',candidates:list,planned,added:[],picks:null,picked_at:null});
 const result=await publishPicks({pool:store,readFeed:async()=>{throw Error('not read');},now:new Date('2026-11-26T23:20:00Z'),build:async()=>{throw Error('not rebuilt');},line:async()=>{throw Error('not rewritten');}});
 assert.equal(result.source,'planned');
 assert.deepEqual(store.saved[0].map(parseRiskArticle).map(a=>[a.ja.title,a.stars,a.pick.source,a.rizel?.ja??null]),[['Story 2',3,'auto','まず自分のルールを確かめます。'],['Story 1',4,'auto','まず自分のルールを確かめます。'],['Story 3',2,'auto',null]]);
});
test('owner mail: on a day the owner picked, the table sentence about ★ is left out (owner-only mail)',()=>{
 const base={url:'https://news.example/x',publishedAt:'2026-11-26T15:00:00.000Z',market:{index:'nas100',session:null,reading:null},quoteId:null,...copy('米国株のニュース')};
 const owner=ownerShockMailText({day:'2026-11-27',articles:[parseRiskArticle({...base,id:sid(1),stars:3,pick:{source:'owner'}})],quotes:[],fallback:false});
 assert.ok(!owner.includes('AIは★を変えません'));assert.ok(owner.includes('載せるニュースと★は、オーナーが選びました。'));
 const auto=ownerShockMailText({day:'2026-11-27',articles:[parseRiskArticle({...base,id:sid(1),stars:3,pick:{source:'auto'}})],quotes:[],fallback:false});
 assert.ok(auto.includes('AIは★を変えません'));
});
test('home notice: weekends and NYSE holidays by the U.S. Eastern date, one constant pair for the wording',()=>{
 assert.equal(marketClosedNotice(new Date('2026-11-26T15:00:00Z'),'ja'),'本日は感謝祭のため、米国市場はお休みです。');
 assert.equal(marketClosedNotice(new Date('2026-11-26T15:00:00Z'),'en'),'U.S. markets are closed today for Thanksgiving.');
 assert.equal(marketClosedNotice(new Date('2026-11-28T15:00:00Z'),'ja'),MARKET_CLOSED_NOTICE.weekend.ja);
 assert.equal(marketClosedNotice(new Date('2026-11-29T15:00:00Z'),'en'),'U.S. markets are closed today.');
 assert.equal(marketClosedNotice(new Date('2026-11-27T15:00:00Z'),'ja'),null,'the early-close Friday is a trading day');
 // Eastern date: Saturday 00:30 JST is still Friday in New York.
 assert.equal(marketClosedNotice(new Date('2026-11-27T15:30:00Z'),'ja'),null);
 // Observed days carry the holiday's own name.
 assert.equal(marketClosedNotice(new Date('2027-07-05T15:00:00Z'),'ja'),'本日は独立記念日のため、米国市場はお休みです。');
 assert.equal(marketClosedNotice(new Date('2027-12-24T15:00:00Z'),'ja'),'本日はクリスマスのため、米国市場はお休みです。');
 // Every NYSE holiday of the calendar has a name, and every named day is a holiday of the calendar.
 assert.equal(Object.keys(US_MARKET_HOLIDAYS).length,20);for(const d of Object.keys(US_MARKET_HOLIDAYS))assert.equal(usMarketSession(new Date(d+'T15:00:00Z')),'holiday',d);
 // Memorial Day (owner, Nov 27): no name, the plain line.
 assert.equal(marketClosedNotice(new Date('2026-05-25T15:00:00Z'),'ja'),'本日の米国市場はお休みです。');assert.equal(marketClosedNotice(new Date('2027-05-31T15:00:00Z'),'en'),'U.S. markets are closed today.');
 for(const [d,name] of [['2026-01-01','元日'],['2026-01-19','キング牧師記念日'],['2026-02-16','大統領の日'],['2026-04-03','聖金曜日'],['2026-06-19','ジューンティーンス'],['2026-09-07','労働者の日'],['2026-12-25','クリスマス']])
  assert.ok(marketClosedNotice(new Date(d+'T15:00:00Z'),'ja').includes(name),d);
});
test('home notice: one line on phones (nowrap, a font that fits the longest holiday name at 360px; measured with Playwright)',async()=>{
 const css=await readFile(new URL('../app/resolute/home/market-closed-note.module.css',import.meta.url),'utf8');
 assert.match(css,/\.note\{[^}]*white-space:nowrap/);assert.match(css,/\.note\{[^}]*font-size:min\(12\.5px,2\.85vw\)/);
 // At 360px the box is 320px wide: 2.85vw = 10.26px per character; the longest line (27 characters) + icon, gap, padding and border fit.
 const longest=Math.max(...Object.keys(US_MARKET_HOLIDAYS).map(d=>[...marketClosedNotice(new Date(d+'T15:00:00Z'),'ja')].length));
 assert.equal(longest,27,'ジューンティーンス (Memorial Day shows no name)');assert.ok(longest*0.0285*360+2+16+14+5<=320);
});

test('one story from the morning mail: only its ★ and RIZEL line change; the other planned stories stay as they are (owner only)',async()=>{
 assert.equal(editTarget(sid(1)),sid(1));assert.equal(editTarget('o'+'c'.repeat(20)),'o'+'c'.repeat(20));assert.equal(editTarget('../x'),null);assert.equal(editTarget(['a']),null);
 const planned=[{id:sid(2),stars:3,rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'}},{id:sid(1),stars:4},{id:sid(3),stars:2,rizel:{ja:'手順を見直します。',en:'Review the steps.',by:'ai'}}];
 const day={picks:null,planned};
 assert.deepEqual(editedPicks(day,sid(1),5,'自分のルールを先に。'),[{id:sid(2),stars:3,rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.'}},{id:sid(1),stars:5,rizel:{ja:'自分のルールを先に。'}},{id:sid(3),stars:2,rizel:{ja:'手順を見直します。',en:'Review the steps.'}}]);
 // The AI line left as it is keeps its English; emptied, the AI writes one at publish time.
 assert.deepEqual(editedPicks(day,sid(2),1,'まず自分のルールを確かめます。')[0],{id:sid(2),stars:1,rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.'}});
 assert.deepEqual(editedPicks(day,sid(2),1,'  ')[0],{id:sid(2),stars:1});
 // After an owner answer, that answer is the set.
 assert.deepEqual(editedPicks({picks:[{id:sid(4),stars:2}],planned},sid(4),4,''),[{id:sid(4),stars:4}]);
 assert.equal(editedPicks(day,sid(9),3,''),null);assert.equal(editedPicks(day,sid(1),6,''),null);
 // The saved set passes the pick checks against the day's candidates.
 const list=[cand(1,'company',1,4),cand(2,'market',1,3),cand(3,'market',2,2)];
 assert.equal(parsePicks(editedPicks(day,sid(1),5,'x'),list).length,3);
 // Saving goes through the owner-only pick API: every other account gets 403.
 const r=await riskRequest(req({action:'picks',day:'2026-11-27',baseRevision:0,picks:editedPicks(day,sid(1),5,'x')}),'user_member',async()=>({canReceiveNotifications:true}),{query:async()=>{throw Error('must not be read');}});
 assert.equal(r.status,403);
});

test('one story from the mail: the 一言 is one note (line breaks kept); the member feed shows it as the quote title with no reasons',async()=>{
 const planned=[{id:sid(2),stars:3,rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.',by:'ai'}},{id:sid(1),stars:4}];
 const day={picks:null,planned};
 // Untouched: the planned note keeps its English.
 assert.deepEqual(editedPicks(day,sid(2),5,'まず自分のルールを確かめます。')[0],{id:sid(2),stars:5,rizel:{ja:'まず自分のルールを確かめます。',en:'Check your own rules first.'}});
 // Edited: the owner's Japanese with its line breaks (empty lines dropped), translated at publish time.
 assert.deepEqual(editedPicks(day,sid(2),5,' 一行目です。\n\n二行目です。 ')[0],{id:sid(2),stars:5,rizel:{ja:'一行目です。\n二行目です。'}});
 assert.deepEqual(editedPicks(day,sid(1),2,'  ')[1],{id:sid(1),stars:2});
 const list=[cand(1,'company',1,4),cand(2,'market',1,3)];
 assert.equal(parsePicks(editedPicks(day,sid(2),5,'a\nb\nc'),list)[0].rizel.ja,'a\nb\nc');
 assert.throws(()=>parsePicks([{id:sid(2),stars:3,rizel:{ja:'a\nb\nc\nd'}}],list),'at most three lines');
 assert.throws(()=>parsePicks([{id:sid(2),stars:3,rizel:{ja:'あ'.repeat(121)}}],list),'at most 120 characters');
 // ?edit= for a story no longer in the plan opens the full page.
 const full={...day,candidates:list,added:[]};
 assert.equal(editableStory(full,sid(2)),true);assert.equal(editableStory({...full,picks:[{id:sid(1),stars:2}]},sid(2)),false);assert.equal(editableStory(null,sid(2)),false);
 // Published note → the member feed's quote: the whole note as the title (line breaks kept), no reasons (nothing extra in くわしく).
 const base={url:'https://news.example/x',publishedAt:'2026-11-26T15:00:00.000Z',market:{index:'nas100',session:null,reading:null},quoteId:null,...copy('米国株のニュース')};
 const articles=[{...base,id:sid(1),stars:3,pick:{source:'owner'},rizel:{ja:'まず自分のルールを確かめます。\n手順は同じです。',en:'Check your own rules first.\nThe steps are the same.',by:'owner'}}];
 const pool={query:async sql=>sql.includes('risk_control')?{rows:[{enabled:true}]}:sql.includes('risk_days')?{rows:[{state:'ready',articles}]}:{rows:[]}};
 const before=process.env.RESOLUTE_RISK_PUBLISH_APPROVED;process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
 try{const feed=await publicRiskFeed(pool,false,new Date('2026-11-26T23:30:00Z'));
  const q=feed.quotes.find(x=>x.id===feed.articles[0].quoteId);
  assert.deepEqual(q.ja,{title:'まず自分のルールを確かめます。\n手順は同じです。',reasons:[]});assert.deepEqual(q.en,{title:'Check your own rules first.\nThe steps are the same.',reasons:[]});
 }finally{if(before===undefined)delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;else process.env.RESOLUTE_RISK_PUBLISH_APPROVED=before;}
 // The cards show the line breaks.
 const {readFile:rf}=await import('node:fs/promises');
 assert.match(await rf(new URL('../app/resolute/home/shock-section.tsx',import.meta.url),'utf8'),/whiteSpace:'pre-line'\}\}>\{quote\[locale\]\.title\}/);
 assert.match(await rf(new URL('../app/resolute/news/screen.tsx',import.meta.url),'utf8'),/whiteSpace:'pre-line'\}\}>\{quote\[locale\]\.title\}/);
});
