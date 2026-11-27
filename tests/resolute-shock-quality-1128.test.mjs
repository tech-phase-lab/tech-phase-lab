import test from 'node:test';
import assert from 'node:assert/strict';
import {editionAt,earlierSessionMention,storyLead} from '../lib/resolute/risk-edition.ts';
import {rubricFor,rubricStars,SHOCK_RUBRIC,RUBRIC_TEXT} from '../lib/resolute/shock-rubric.ts';
import {numbersNote,NO_NUMBERS,parseCandidate,autoPicks,rizelIssues,UNJUDGED} from '../lib/resolute/shock-picks.ts';
import {parseRiskArticle,SUMMARY_QUESTION,marketStars} from '../lib/resolute/risk.ts';
import {measureStory,editionIntake,buildCandidates,rankStories,rankInput,validateRanking,ruleRanking,candidatesMailText,runCandidates,writeRizelLine,rizelInput,RIZEL_INSTRUCTIONS,
 RANK_INSTRUCTIONS,RANK_SCHEMA,RANK_MAX_TOKENS,translateTitles,checkTitleJa,planPicks,rankFailureLine,storyTerms} from '../services/resolute-api/shock-candidates.mjs';
import {serializeBudgetedRequest,MAX_OUTPUT_TOKENS,AI_REQUEST_RESERVATION_USD} from '../services/resolute-api/ai-budget.mjs';
import {withSessionMovesFallback,MOVES_FALLBACK} from '../services/resolute-api/risk-moves.mjs';
import {hash} from '../services/resolute-api/risk-store.mjs';

// Sat Nov 28 06:02 JST: the candidate run of Nov 27 21:02 UTC. Friday's session (early close, 13:00 New York) is the latest closed one.
const RUN=new Date('2026-11-27T21:02:00Z'),EDITION=editionAt(RUN);
const filler='The report described the session in detail, with comments from strategists and traders about the drivers of the move and the sectors involved.';
const row=(title,publishedAt,{body=`${title}. ${filler}`,tickers=[],lane='market'}={})=>({title,bodyEn:body,url:`https://news.example/${hash(title).slice(0,16)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
const WED_JA='新たな関税とインフレ懸念で米株が下落 — 米国株は水曜日に下落しました。新たな関税の発表とインフレへの懸念が重荷になりました。';
const fri={'2026-11-27':{nas100:{previousDate:'2026-11-25',changePercent:-1.2,typicalPercent:0.8,up:30,down:70,total:100},sox:{previousDate:'2026-11-25',changePercent:-2.4,typicalPercent:2,up:10,down:30,total:40},fear:{level:22,previousLevel:20}}};

test('1: a story about an earlier session by weekday or date is not this edition\'s news (the exact Nov 28 case)',()=>{
 assert.equal(EDITION.session,'2026-11-27');
 assert.equal(earlierSessionMention(WED_JA,EDITION),true,'水曜日 is Wednesday Nov 25: not in Saturday\'s edition (session Friday Nov 27)');
 for(const t of ['U.S. stocks fell on Wednesday as new tariffs and inflation worries weighed','Wednesday\'s selloff: Nasdaq drops 2%','Stocks slid in the Wednesday session','Stocks closed lower Nov. 25 on tariff fears','米国株は11月25日に下落しました','25日の米国株は下落した','水曜の米国株式市場は下落','U.S. markets closed on Thursday for Thanksgiving'])
  assert.equal(earlierSessionMention(t,EDITION),true,t);
 for(const t of ['Stocks fell on Friday in a shortened session','金曜日の米国株は小幅に下落','27日の米国株は下落','Stocks rose Friday after Wednesday\'s drop','The Fed meets next Wednesday; stocks were little changed','来週水曜の会合を前に米国株は横ばい','Nvidia unveils a new chip on Wednesday','Stocks closed lower Nov. 27 in a half-day session','Tariff worries hit stocks','Stocks slip on Saturday news of new tariffs'])
  assert.equal(earlierSessionMention(t,EDITION),false,t);
 // A Monday edition (session Friday): weekend news is new; Thursday is not.
 const mon=editionAt(new Date('2026-11-29T21:00:00Z'));assert.equal(mon.session,'2026-11-27');
 assert.equal(earlierSessionMention('Stocks futures fell on Sunday after the tariff news',mon),false);assert.equal(earlierSessionMention('Stocks fell on Thursday',mon),true);
 // In the intake (headline + lead), English and Japanese sources alike; the Friday story stays.
 const feed=feedOf([row('新たな関税とインフレ懸念で米株が下落','2026-11-27T10:00:00.000Z',{body:`${WED_JA}${filler}`}),
  row('Stocks fall on new tariffs and inflation fears','2026-11-27T09:00:00.000Z',{body:`U.S. stocks fell on Wednesday as new tariffs and inflation worries weighed on investors. ${filler}`}),
  row('Stocks slip in holiday-shortened session as tariffs weigh','2026-11-27T18:30:00.000Z',{body:`U.S. stocks slipped on Friday in a shortened session after new tariffs were announced. ${filler}`})]);
 const {stories,diagnostics}=editionIntake(feed,RUN,{moves:fri});
 assert.deepEqual(stories.map(s=>s.title),['Stocks slip in holiday-shortened session as tariffs weigh']);
 assert.equal(diagnostics.earlierSession,2);
 assert.ok(storyLead('T','One. Two. Three. Four.').endsWith('Three.'),'the lead is the first three sentences');
});

const copy=(title,content)=>({ja:{title,source:'Example Wire',content:`${content}\n${SUMMARY_QUESTION.ja}`,date:'2026年11月27日'},en:{title,source:'Example Wire',content:`Reported.\n${SUMMARY_QUESTION.en}`,date:'November 27, 2026'}});
const draftOf=(c,content)=>parseRiskArticle({id:c.id,url:c.url,publishedAt:c.publishedAt,market:{index:'nas100',session:null,reading:null},stars:null,quoteId:null,...copy(c.title.slice(0,80),content)});
test('1: a summary that says the move happened on an earlier session is dropped and the next story takes its place',async()=>{
 const feed=feedOf([row('Tariff worries hit stocks','2026-11-27T12:00:00.000Z'),row('Oil prices fall as OPEC+ talks drag on','2026-11-27T13:00:00.000Z')]);
 const summarize=async c=>draftOf(c,c.title.startsWith('Tariff')?'米国株は水曜日に下落しました。新たな関税への懸念が重荷になりました。':'原油価格が下落しました。OPECプラスの協議が長引いています。');
 const built=await buildCandidates({feed,now:RUN,moves:fri,rank:async({stories})=>({by:'ai',attempts:1,ranking:{market:stories.map((s,i)=>({key:`s${i+1}`,stars:3,reason:{ja:'市場全体のニュース',en:'Market-wide.'}})),company:[]}}),summarize,translate:async({titles})=>titles.map(()=>null)});
 assert.deepEqual(built.candidates.map(c=>c.source.title),['Oil prices fall as OPEC+ talks drag on']);
 assert.equal(built.diagnostics.summaryEarlierSession,1);
});

test('2: the candidate run measures the latest closed session itself when the snapshot lacks it (lease, background tier)',async()=>{
 assert.deepEqual(MOVES_FALLBACK,{tier:'background',perMinute:60,deadlineMs:240000});
 const shock={'2026-11-27':{nas100:{date:'2026-11-27',...fri['2026-11-27'].nas100},sox:{date:'2026-11-27',...fri['2026-11-27'].sox},fear:{date:'2026-11-27',level:22,previousLevel:20}}};
 let collected=0,taken=null;const lease={take:async()=>true,limited(){},report:()=>({credits:140,leases:14,refused:0,mode:'allocator'})};
 const collect=async(config,session)=>{collected++;taken={config,session};return {shock,shockStocks:{},shockIntraday:{}};};
 // The thermometer snapshot has nothing yet (it is written at 07:30 JST; today its job crashed).
 const read=withSessionMovesFallback(async()=>({}),'key',{collect,lease});
 const moves=await read(['2026-11-27']);
 assert.equal(moves['2026-11-27'].nas100.changePercent,-1.2);assert.equal(taken.session,'2026-11-27');assert.equal(taken.config.lease,lease);
 assert.deepEqual(read.stats,{stored:0,fetched:1,source:'provider',credits:140});
 await read(['2026-11-27']);assert.equal(collected,1,'one provider read per run');
 // A stored snapshot is used as it is; the thermometer reader may be missing or failing.
 const stored=withSessionMovesFallback(async()=>({'2026-11-27':{nas100:fri['2026-11-27'].nas100}}),'key',{collect:async()=>{throw Error('not called');},lease});
 assert.equal((await stored(['2026-11-27']))['2026-11-27'].nas100.changePercent,-1.2);
 const broken=withSessionMovesFallback(async()=>{throw Error('db');},'key',{collect,lease});assert.ok((await broken(['2026-11-27']))['2026-11-27']);
 assert.equal(withSessionMovesFallback(null,undefined),null,'no reader and no key: no numbers, as before');
 const failing=withSessionMovesFallback(null,'key',{collect:async()=>{throw Error('provider');},lease});assert.deepEqual(await failing(['2026-11-27']),{});assert.equal(failing.stats.fetchError,true);
 // End to end: the 06:00 run's stories carry Friday's numbers.
 const pool={query:async sql=>({rows:sql.includes('RETURNING day')?[{day:'2026-11-28'}]:[]})},sent=[];
 const feed=feedOf([row('Stocks slip in holiday-shortened session as tariffs weigh','2026-11-27T16:00:00.000Z')]);
 const r=await runCandidates({pool,readFeed:async()=>feed,readMoves:withSessionMovesFallback(null,'key',{collect,lease}),now:RUN,mail:async x=>{sent.push(x);return {state:'sent'};},
  rank:async({stories})=>({by:'ai',attempts:1,ranking:{market:stories.map((s,i)=>({key:`s${i+1}`,stars:4,reason:{ja:'新しい関税のニュース',en:'New tariffs.'}})),company:[]}}),
  summarize:async c=>draftOf(c,'金曜日の米国株は下落しました。新しい関税が重荷になりました。'),line:async()=>null});
 assert.equal(r.diagnostics.measured,1);assert.equal(r.diagnostics.moves.source,'provider');
 const text=candidatesMailText(sent[0]);
 assert.ok(text.includes('数字:\n'),'numbers are in the mail');assert.ok(!text.includes('まだありません'));
});

test('2: when there are no numbers the wording says why',()=>{
 const m=(market)=>({market});
 assert.equal(numbersNote(m({index:'nas100',session:null,reading:null})),NO_NUMBERS.notClosed.ja);
 assert.match(NO_NUMBERS.notClosed.ja,/このニュースのあとの米国市場の取引が、まだ終わっていません/);
 assert.equal(numbersNote(m({index:'nas100',session:'2026-11-27',reading:null})),NO_NUMBERS.notMeasured.ja);
 assert.equal(numbersNote(m({index:'company',session:null,reading:null})),NO_NUMBERS.unlisted.ja);
 for(const v of Object.values(NO_NUMBERS))assert.ok(!v.ja.includes('休場'),'never the old catch-all');
});

test('3: the ranking request fits the per-request caps (it asked for 2500 output tokens against a cap of 1800)',async()=>{
 assert.ok(RANK_MAX_TOKENS<=MAX_OUTPUT_TOKENS);
 // Worst case at the caps stays inside the 10-cent reservation: 64,000 input tokens and MAX_OUTPUT_TOKENS output tokens.
 assert.ok(64000*0.75/1e6+MAX_OUTPUT_TOKENS*4.5/1e6<AI_REQUEST_RESERVATION_USD);
 // A busy day: 48 stories with long texts. The excerpt shrinks until the request fits 64,000 bytes.
 const stories=Array.from({length:70},(_,i)=>({title:`Story ${i} about tariffs and chips "quoted" ${'x'.repeat(80)}`,body:'Body text with "quotes" and detail. '.repeat(60),publishedAt:'2026-11-27T12:00:00.000Z',group:i%2?'company':'market',market:{index:'nas100',session:null,reading:null},tickers:[]}));
 const input=rankInput({day:'2026-11-28',stories});
 assert.ok(input.stories[0].text.length<600);assert.deepEqual(input.stories[0].rubric,{type:'trade',min:3,max:5});
 const body={model:'gpt-5.4-mini',store:false,reasoning:{effort:'none'},max_output_tokens:RANK_MAX_TOKENS,instructions:RANK_INSTRUCTIONS,input:JSON.stringify(input),text:{format:{type:'json_schema',name:'resolute_shock_rank',strict:true,schema:RANK_SCHEMA}}};
 assert.doesNotThrow(()=>serializeBudgetedRequest(body));
 // Through the real model call (budget reservation and settlement), the ranking succeeds on the first attempt.
 const env={...process.env};process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD='5';process.env.RESOLUTE_OPENAI_API_KEY='test-key';
 try{
  const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{reserved_usd:0.1}]};}};
  const fetcher=async(_u,init)=>{const sent=JSON.parse(init.body);assert.equal(sent.max_output_tokens,RANK_MAX_TOKENS);
   return new Response(JSON.stringify({status:'completed',usage:{input_tokens:15000,output_tokens:2400},output:[{content:[{type:'output_text',text:JSON.stringify({market:[{key:'s1',stars:1,reasonJa:'新しい関税の話題',reasonEn:'New tariffs.'}],company:[]})}]}]}));};
  const r=await rankStories({day:'2026-11-28',stories,budgetPool:pool,now:RUN,fetcher,sleep:async()=>{}});
  assert.equal(r.by,'ai');assert.equal(r.attempts,1);
  assert.equal(r.ranking.market[0].stars,3,'a tariff story\'s ★ is kept inside the rubric range (★1 → ★3)');
  // Every failure is retried twice, after a pause (owner, Nov 28), and the cause is kept for the mail and the log.
  let attempts=0;const pauses=[];const refused=await rankStories({day:'2026-11-28',stories,budgetPool:pool,now:RUN,call:async()=>{attempts++;throw Error('BUDGET_LIMIT');},sleep:async ms=>{pauses.push(ms);}});
  assert.equal(attempts,3);assert.deepEqual(pauses,[5000,20000]);assert.equal(refused.failure,'BUDGET_LIMIT');assert.equal(refused.by,'rule');
  let n=0;const second=await rankStories({day:'2026-11-28',stories,budgetPool:pool,now:RUN,call:async()=>{if(++n===1)throw Error('MODEL_UNAVAILABLE');return {market:[{key:'s1',stars:4,reasonJa:'新しい関税の話題',reasonEn:'New tariffs.'}],company:[]};},sleep:async()=>{}});
  assert.deepEqual([second.by,second.attempts],['ai',2]);
 }finally{process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD=env.RESOLUTE_AI_MONTHLY_LIMIT_USD;process.env.RESOLUTE_OPENAI_API_KEY=env.RESOLUTE_OPENAI_API_KEY;if(env.RESOLUTE_AI_MONTHLY_LIMIT_USD===undefined)delete process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD;if(env.RESOLUTE_OPENAI_API_KEY===undefined)delete process.env.RESOLUTE_OPENAI_API_KEY;}
});

test('7: one ★ rubric for the AI and the rule — tariffs and Fed surprises ≥★3, routine notes ≤★2, measured moves inside the range',()=>{
 for(const t of ['Trump announces new chip tariffs','Stocks fall on new tariffs and inflation fears','新たな関税とインフレ懸念で米株が下落','China retaliates with duties on U.S. goods'])assert.ok(rubricStars(t)>=3,t);
 for(const t of ['Fed unexpectedly raises rates in emergency move','Fed surprises markets with jumbo cut','FRBが予想外の利上げ'])assert.ok(rubricStars(t)>=3&&rubricFor(t).key==='fed-surprise',t);
 assert.ok(rubricStars('Fed holds rates steady')>=3);
 for(const t of ['Morgan Stanley raises Nvidia price target to $250','Analyst reiterates buy rating on AMD','Apple unveils new iPad'])assert.ok(rubricStars(t)<=2,t);
 assert.ok(rubricStars('Apple CEO Tim Cook to step down',['AAPL'])>=4);
 assert.ok(rubricStars('Iran threatens to close the Strait of Hormuz')>=4);
 assert.ok(rubricStars('Nasdaq tumbles 3% as AI stocks sell off')>=4);
 assert.equal(rubricStars('Moody\'s downgrades Microsoft outlook to negative',['MSFT']),3);
 // The measured move's table ★ is used inside the range: a quiet day cannot take a tariff story below ★3, a big move cannot lift a note above ★2.
 assert.equal(rubricStars('Trump announces new chip tariffs',[],1),3);assert.equal(rubricStars('Trump announces new chip tariffs',[],5),5);
 assert.equal(rubricStars('Analyst reiterates buy rating on AMD',[],5),2);
 for(const r of SHOCK_RUBRIC)assert.ok(r.min>=1&&r.max<=5&&r.min<=r.usual&&r.usual<=r.max,r.key);
 assert.ok(RANK_INSTRUCTIONS.includes(RUBRIC_TEXT));
 // The AI's ★ outside the range is moved to its nearest end.
 const input={stories:[{key:'s1',title:'Trump announces new chip tariffs',rubric:{type:'trade',min:3,max:5}},{key:'s2',title:'Analyst note',rubric:{type:'routine',min:1,max:2}}]};
 const v=validateRanking({market:[{key:'s1',stars:1,reasonJa:'新しい関税',reasonEn:'New tariffs.'}],company:[{key:'s2',stars:5,reasonJa:'アナリストの見方',reasonEn:'An analyst note.'}]},input);
 assert.deepEqual([v.market[0].stars,v.company[0].stars],[3,2]);
});

test('4: AI ranking failed — priority and market-wide first, ★ from the rubric and the measured move, one plain line at the top of the mail',()=>{
 const st=[{title:'Acme wins contract',group:'company',market:{index:'company',session:null,reading:null},tickers:[]},{title:'Stocks drift ahead of data',group:'market',market:{index:'nas100',session:null,reading:null},tickers:[]},
  {title:'Trump announces new chip tariffs',group:'market',market:{index:'nas100',session:null,reading:null},tickers:[]},{title:'Apple CEO Tim Cook to step down',group:'company',market:{index:'company',session:null,reading:null},tickers:['AAPL']},
  {title:'Analyst reiterates buy rating on AMD',group:'company',market:{index:'company',session:null,reading:null},tickers:['AMD']}];
 // No numbers and no AI: the ★ is not judged (never ★1 for missing numbers); must-capture topics first in each list.
 const r=ruleRanking(st);
 assert.deepEqual(r.market.map(p=>[p.key,p.stars]),[['s3',null],['s2',null]]);
 assert.deepEqual(r.company.map(p=>[p.key,p.stars]),[['s4',null],['s1',null],['s5',null]]);
 assert.equal(r.market[0].reason.ja,'重要な話題（関税）。★は未判定。オーナーが決めてください（AIの判定ができず、値動きの数字もまだないため。目安は★3〜5）');
 for(const p of [...r.market,...r.company])assert.ok(!p.reason.ja.includes('記事の順'),'never "in article order"');
 // With Friday's numbers: the measured move's table ★ inside the rubric range, and a must-capture topic never below ★3.
 const measured=[['Trump announces new chip tariffs','market'],['Oil prices dip as OPEC+ talks drag on','market'],['Stocks drift ahead of data','market']].map(([title,group])=>({title,group,tickers:[],market:measureStory({title,tickers:[],publishedAt:'2026-11-27T12:00:00.000Z'},fri,EDITION)}));
 const tableOf=m=>marketStars(m);assert.ok(tableOf(measured[2].market)>=1);
 const rm=ruleRanking(measured).market;
 for(const p of rm)assert.ok(Number.isInteger(p.stars),p.key);
 assert.ok(rm.find(p=>p.key==='s1').stars>=3);assert.ok(rm.find(p=>p.key==='s2').stars>=3,'oil is a must-capture topic: ★3 or more');
 assert.deepEqual(rm.map(p=>p.key).slice(0,2),['s1','s2'],'tariff (topic 5) before oil (topic 9), then the rest');
 const line=rankFailureLine({by:'rule',failure:'AI_REQUEST_OUTSIDE_BUDGET'});
 assert.equal(line,'※ 今日はAIによる並べ替えができませんでした（AIへの依頼が、1回あたりの大きさの上限を超えたため）。重要な話題と市場全体のニュースを先に並べ、★は値動きの数字があるものだけ付けています。数字のないものは★が未判定です。');
 assert.equal(rankFailureLine({by:'ai'}),null);
 const mk=(n,stars)=>parseCandidate({id:hash('x'+n),url:'https://news.example/x'+n,publishedAt:'2026-11-27T12:00:00.000Z',group:'market',rank:n,source:{title:'Trump announces new chip tariffs '+n,tickers:[],publisher:'Example Wire'},
  ...copy(`トランプ氏が半導体に新たな関税${n}`,'トランプ氏が半導体への新たな関税を発表しました。'),market:{index:'nas100',session:null,reading:null},suggested:{stars,reason:stars?{ja:'重要な話題（関税）',en:'Tariffs.'}:r.market[0].reason,by:'rule'}});
 const judged=mk(1,4),open=mk(2,null);
 // A story whose ★ is not judged is never published automatically.
 assert.deepEqual(autoPicks([judged,open]).map(p=>p.id),[judged.id]);assert.deepEqual(autoPicks([open]),[]);
 const text=candidatesMailText({day:'2026-11-28',candidates:[judged,open],planned:[{id:judged.id,stars:4}],rank:{by:'rule',failure:'BUDGET_LIMIT'}});
 assert.equal(text.split('\n')[2],'※ 今日はAIによる並べ替えができませんでした（今月のAI費用が上限に達したため）。重要な話題と市場全体のニュースを先に並べ、★は値動きの数字があるものだけ付けています。数字のないものは★が未判定です。');
 assert.ok(!text.includes('記事の順に並べました'));assert.ok(text.includes('★4（★★★★☆）'));
 assert.ok(text.includes('★が未判定のニュース（1件。選ばなければ公開しません）:\n・トランプ氏が半導体に新たな関税2\n  ★は未判定。オーナーが決めてください'));
 const none=candidatesMailText({day:'2026-11-28',candidates:[open],planned:[],rank:{by:'rule',failure:'MODEL_UNAVAILABLE'}});
 assert.ok(none.includes('★が決まったニュースがないため、自動では公開しません。'));
});

test('5/6: headlines without a summary are translated to Japanese (checked); a failed translation is said, never shown in English',async()=>{
 assert.equal(checkTitleJa('エヌビディア、50億ドルの投資を発表','Nvidia announces $5 billion investment'),'エヌビディア、50億ドルの投資を発表');
 assert.equal(checkTitleJa('エヌビディア、70億ドルの投資を発表','Nvidia announces $5 billion investment'),null,'no new numbers');
 assert.equal(checkTitleJa('Nvidia announces investment','Nvidia announces investment'),null,'must be Japanese');
 assert.equal(checkTitleJa('株価は一時的に下落','Shares dip'),null,'banned wording');
 const out=await translateTitles({titles:['Stocks fall on tariffs','既に日本語の見出し','Oil jumps'],call:async({input})=>{assert.deepEqual(JSON.parse(input).titles,['Stocks fall on tariffs','Oil jumps']);return {titles:['関税で米国株が下落','原油が急伸']};}});
 assert.deepEqual(out,['関税で米国株が下落','既に日本語の見出し','原油が急伸']);
 assert.deepEqual(await translateTitles({titles:['A'],call:async()=>{throw Error('MODEL_UNAVAILABLE');}}),[null]);
 const text=candidatesMailText({day:'2026-11-28',candidates:[],planned:[],withheld:[{title:'Stocks fall on tariffs',titleJa:'関税で米国株が下落',url:'https://news.example/a',reason:'not-publishable'},{title:'Oil jumps',titleJa:null,url:'https://news.example/b',reason:'new-number'}]});
 assert.ok(text.includes('要約できなかったニュース（2件）:'));assert.ok(text.includes('・関税で米国株が下落'));
 assert.ok(text.includes('・（見出しを日本語にできませんでした） https://news.example/b'));assert.ok(!/Stocks fall|Oil jumps/.test(text));
});

const art=(title,content,titleEn=title)=>parseRiskArticle({id:hash(title),url:'https://news.example/'+hash(title).slice(0,8),publishedAt:'2026-11-27T12:00:00.000Z',stars:3,quoteId:null,market:{index:'nas100',session:null,reading:null},pick:{source:'auto'},
 ja:{title,source:'Example Wire',content:`${content}\n${SUMMARY_QUESTION.ja}`,date:'2026年11月27日'},en:{title:titleEn,source:'Example Wire',content:`Reported.\n${SUMMARY_QUESTION.en}`,date:'November 27, 2026'}});
const GB=art('上海のデータセンターでNVIDIAのGB300が見つかる','上海のデータセンターで、輸出に米国の許可が必要なNVIDIAのGB300やGB200が見つかった。GB300は1400万ドルの融資の担保にも使われていた。','NVIDIA GB300 found at a Shanghai data center');
test('8: the RIZEL note is about this story (a concrete word is required), in the owner\'s voice, without the stock phrases',()=>{
 const story={title:GB.ja.title,summary:'上海のデータセンターで、輸出に米国の許可が必要なNVIDIAのGB300やGB200が見つかった。GB300は1400万ドルの融資の担保にも使われていた。',titleEn:GB.en.title};
 // The owner's own post (the target voice) passes, its article numbers included.
 assert.deepEqual(rizelIssues({ja:'上海のデータセンターでGB300が見つかった。1400万ドルの融資の担保にも使われていたらしい。この良い流れを崩すなよ…。',en:'GB300 chips turned up in Shanghai, even as collateral for a $14 million loan. Don\'t break this good run...'},story),[]);
 // The stock phrases of the Nov 28 mail and every story-free line are refused.
 for(const ja of ['関税やインフレの見出しに流されず、まず自分の基準を確認します。ニュースは材料であって、判断は手順で整えるのです。','まず自分のルールを確認します。','見出しだけに振り回されず、自分のルールを確かめましょう。'])
  assert.ok(rizelIssues({ja,en:'Check your own rules first.'},story).some(c=>c==='cliche'||c==='generic'),ja);
 assert.ok(rizelIssues({ja:'今日は落ち着いていこう。',en:'Stay calm today.'},story).includes('generic'),'no concrete word of the story');
 assert.ok(rizelIssues({ja:'GB300が2000万ドルの担保に。',en:'GB300 as collateral for $20 million.'},story).includes('number'),'a number not in the article');
 assert.ok(rizelIssues({ja:'GB300の件でNVDAの株価は下がるはず。',en:'NVDA will fall on the GB300 news.'},story).includes('price-call'));
 assert.ok(rizelIssues({ja:'GB300の件、今が買い時。',en:'GB300: a buying opportunity.'},story).length);
 assert.deepEqual(rizelIssues({ja:'GB300'+'あ'.repeat(100),en:'x'},story),['shape'],'at most 100 characters');
 assert.ok(rizelIssues({ja:'GB300が見つかった件、気にしすぎなくていい。',en:'x'},{...story,avoid:['GB300が見つかった件、気にしすぎなくていい。']}).includes('repeat'));
 assert.ok(storyTerms(story.title,story.summary).includes('GB300')&&storyTerms(story.title).includes('上海'));
 // The instructions: the concrete-word rule, the ★ temperatures, the owner's sample, the banned stock phrases.
 for(const s of ['MUST name at least one concrete thing','気にしすぎなくていい','この良い流れを崩すなよ…。','まず自分のルールを確認','見出しに流されず','判断は手順で','at most 100 characters','may be used exactly as written'])assert.ok(RIZEL_INSTRUCTIONS.includes(s),s);
});
test('8: ★1, ★3 and ★5 stories get different notes in different temperatures; the model gets the story facts and the ★',async()=>{
 const a=art('トランプ氏が半導体に新たな関税','トランプ氏が中国製の半導体に新たな関税を課すと発表した。'),b=art('FRBが政策金利を据え置き','FRBは政策金利を据え置いた。パウエル議長は次回会合での判断はデータ次第と述べた。'),c=art('アナリストがAMDの目標株価を維持','アナリストがAMDの目標株価を維持した。');
 const ia=rizelInput(a,5);
 assert.deepEqual([ia.title,ia.stars,ia.tone],['トランプ氏が半導体に新たな関税',5,'firm']);assert.match(ia.summary,/中国製の半導体に新たな関税/);
 assert.deepEqual([rizelInput(b,3).tone,rizelInput(c,1).tone],['steady','calm']);
 // A model that writes from what it is given (the story's words, the tone): what the prompt carries decides the note.
 const seen=[];const call=async({input})=>{const x=JSON.parse(input);seen.push(x);
  if(x.tone==='firm')return {ja:'中国製の半導体に新たな関税か。せっかくの良い流れを崩すなよ…。',en:'New tariffs on Chinese chips. Don\'t break this good run...'};
  if(x.tone==='steady')return {ja:'FRBは金利を据え置き。気になるのはパウエル議長の言う次回会合のデータ次第の部分。',en:'The Fed held. The part to watch: Powell says the next meeting depends on data.'};
  return {ja:'AMDの目標株価は維持。気にしすぎなくていい。',en:'AMD\'s target kept. No need to worry too much.'};};
 const la=await writeRizelLine({article:a,stars:5,call}),lb=await writeRizelLine({article:b,stars:3,call}),lc=await writeRizelLine({article:c,stars:1,call});
 assert.ok(la&&lb&&lc,'all three pass the checks');
 assert.equal(new Set([la.ja,lb.ja,lc.ja]).size,3);
 assert.match(la.ja,/関税/);assert.match(la.ja,/崩すなよ/);assert.match(lb.ja,/FRB|パウエル/);assert.match(lc.ja,/AMD/);assert.match(lc.ja,/気にしすぎなくていい/);
 assert.deepEqual(seen.map(x=>[x.stars,x.tone]),[[5,'firm'],[3,'steady'],[1,'calm']]);
 // A generic note is rewritten once, then dropped.
 let calls=0;assert.equal(await writeRizelLine({article:a,stars:5,call:async()=>{calls++;return {ja:'まず自分のルールを確認します。',en:'Check your own rules first.'};}}),null);assert.equal(calls,2);
 // The day's plan never repeats a note: the earlier notes are passed as "avoid" and a copy is refused.
 const fixed=async()=>({ja:'関税の話か。良い流れを崩すなよ…。',en:'Tariffs again. Don\'t break the good run...'});
 const c1=art('関税で米国株が下落','関税で米国株が下落した。'),c2=art('関税で半導体株が下落','関税で半導体株が下落した。');
 const cands=[c1,c2].map((x,i)=>parseCandidate({id:x.id,url:x.url,publishedAt:x.publishedAt,group:'market',rank:i+1,source:{title:'Stocks fall on tariffs '+i,tickers:[],publisher:'Example Wire'},ja:x.ja,en:x.en,market:x.market,suggested:{stars:4,reason:{ja:'関税',en:'Tariffs.'},by:'ai'}}));
 const avoids=[];const planned=await planPicks({candidates:cands,line:async o=>{avoids.push(o.avoid);return writeRizelLine({...o,call:fixed});}});
 assert.deepEqual(avoids[1],['関税の話か。良い流れを崩すなよ…。']);
 assert.ok(planned[0].rizel&&!planned[1].rizel,'the copy is not used again');
 assert.equal(UNJUDGED.ja,'★は未判定。オーナーが決めてください');
});
