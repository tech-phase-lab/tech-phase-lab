import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {firstCloseAfter,storyIndex,applyMarketReaction,readSessionMoves,waitingMarket} from '../lib/resolute/risk-market.ts';
import {RIZEL_DISCLAIMER,SUMMARY_QUESTION,parseRiskArticle,measureDay} from '../lib/resolute/risk.ts';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';
import {summaryIssues,rizelCopyIssues,quoteIssues,RIZEL_REWRITES,rizelRewrite} from '../lib/resolute/risk-copy-check.ts';
import {eligibleCopies} from '../lib/resolute/rizel-selection.ts';
import {RISK_VISUAL_FIXTURE,RISK_PREVIEW_DETAILS} from '../lib/resolute/risk-preview.ts';
import {RIZEL_QUOTE_DRAFTS} from '../lib/resolute/rizel-quote-drafts.ts';
import {reviewScenarioFeed} from '../lib/resolute/review-scenarios.ts';
import {dailyMove,equalWeightLevels,sessionShock,sessionFear} from '../lib/resolute/thermometer-basket.ts';
import {safeThermometerSnapshot} from '../lib/resolute/thermometer-runtime.ts';
import {generate,validateGeneration,fillMarketReactions,SUMMARY_INSTRUCTIONS} from '../services/resolute-api/risk-job.mjs';
import {riskRequest,publicRiskFeed,hash} from '../services/resolute-api/risk-store.mjs';
import {rizelReviewRequest,markReapproval} from '../services/resolute-api/rizel-review-store.mjs';
import {prepareDailyReview} from '../services/resolute-api/rizel-daily-review.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const candidate={id:hash('https://investor.nvidia.com/shock'),url:'https://investor.nvidia.com/shock',title:'NVIDIA warns of export restrictions',body:'NVIDIA said on October 12 that export restrictions across the semiconductor sector are planned. Revenue was 57 billion dollars.',publishedAt:'2026-10-12T18:00:00.000Z',source:'official',tickers:['NVDA']};
const clean={publishable:true,ja:{title:'NVIDIAが輸出規制について発表',source:'NVIDIAの公式発表',content:'NVIDIAが10月12日、半導体業界への輸出規制が計画段階にあると発表しました。',date:'10月12日の発表'},en:{title:'NVIDIA on export restrictions',source:'NVIDIA announcement',content:'NVIDIA said on October 12 that export restrictions across the semiconductor sector are planned.',date:'October 12'}};
const banned={...clean,ja:{...clean.ja,content:'NVIDIAが輸出規制を発表しました。影響は小さいと見られ、一時的な下げになりそうです。'}};

test('the first U.S. close after the news: weekends, exactly at the close, early closes, holidays, unknown calendar',()=>{
 for(const [at,expected] of [
  ['2026-10-12T19:59:00Z','2026-10-12'], // Mon 15:59 New York (EDT): that day's close
  ['2026-10-12T20:00:00Z','2026-10-13'], // exactly 16:00: the next close
  ['2026-10-17T15:00:00Z','2026-10-19'], // Saturday news waits for Monday
  ['2026-10-18T22:00:00Z','2026-10-19'], // Monday 07:00 JST (Sunday in New York)
  ['2026-11-27T17:59:00Z','2026-11-27'], // early close 13:00 EST
  ['2026-11-27T18:00:00Z','2026-11-30'],
  ['2026-11-26T15:00:00Z','2026-11-27'], // Thanksgiving holiday
  ['2028-01-05T15:00:00Z',null],['bad',null]])assert.equal(firstCloseAfter(new Date(at)),expected,at);
});

test('one related TP index per story, from the headline\'s scope: market-wide TP大型株100, the chip sector TP半導体40, one company none',()=>{
 assert.equal(storyIndex('Apple faces a probe in Europe'),'company');
 assert.equal(storyIndex('Nvidia falls 3% as rivals gain'),'company'); // one chip company is still one company's news
 assert.equal(storyIndex('米商務省がAI半導体の対中規制を拡大へ'),'sox');
 assert.equal(storyIndex('Chipmakers slide as export curbs widen'),'sox');
 assert.equal(storyIndex('Nasdaq tumbles as Treasury yields surge'),'nas100');
 assert.equal(storyIndex('Fed minutes show officials split on a December cut'),'nas100');
 assert.deepEqual(waitingMarket('nas100','2026-10-17T15:00:00Z'),{index:'nas100',session:'2026-10-19',reading:null});
 assert.deepEqual(waitingMarket('company','2026-10-17T15:00:00Z'),{index:'company',session:null,reading:null});
});

const mv=(changePercent,typicalPercent=1,down=35,total=40)=>({previousDate:'2026-10-09',changePercent,typicalPercent,up:changePercent>0?down:total-down,down:changePercent>0?total-down:down,total});
test('both indices are measured on that close only, the stronger sets the stars; before it the story waits',()=>{
 const article=validateGeneration(clean,candidate);
 assert.deepEqual(article.market,{index:'sox',session:'2026-10-12',reading:null});assert.equal(article.stars,null);
 assert.equal(applyMarketReaction(article,{}).stars,null);
 assert.equal(applyMarketReaction(article,{'2026-10-13':{sox:mv(-9)}}).stars,null); // a later close never counts
 // The other index alone is enough: both are always measured (owner, Nov 25).
 assert.equal(applyMarketReaction(article,{'2026-10-12':{nas100:mv(-1.6)}}).stars,2);
 assert.equal(applyMarketReaction(article,{'2026-10-12':{sox:{changePercent:-9}}}).stars,null); // a move without its typical move and breadth is not measured
 const filled=applyMarketReaction(article,{'2026-10-12':{sox:mv(-3.24,1.08,34,40),nas100:mv(-1.6,0.8,70,100),fear:{level:30,previousLevel:27}}});
 assert.deepEqual(filled.market,{index:'sox',session:'2026-10-12',reading:{from:'2026-10-09',sox:{changePercent:-3.2,multiple:3,same:34,total:40},nas100:{changePercent:-1.6,multiple:2,same:70,total:100},fearChange:11}});
 assert.equal(filled.stars,4); // TP半導体40 ★4, TP大型株100 ★3: the stronger
 assert.equal(parseRiskArticle(filled).stars,4);
 assert.equal(applyMarketReaction(filled,{'2026-10-12':{sox:mv(8,0.5)}}),filled); // never re-scored
});

test('thermometer snapshots carry each basket\'s move and the shock map (typical move, breadth, fear), sanitized and dated',async()=>{
 const levels=[{date:'2026-10-08',close:100},{date:'2026-10-09',close:110},{date:'2026-10-12',close:106.48}];
 const move=dailyMove(levels,'2026-10-12');assert.equal(move.date,'2026-10-12');assert.equal(move.previousDate,'2026-10-09');assert.ok(Math.abs(move.changePercent+3.2)<1e-9);
 assert.equal(dailyMove(levels,'2026-10-13'),null);assert.equal(dailyMove(levels.slice(0,1),'2026-10-08'),null);
 const absent={status:'unavailable',reason:'not-configured'};
 const reading={...move,typicalPercent:1.2,up:3,down:36,total:40};
 const safe=safeThermometerSnapshot({asOf:'2026-10-12',nas100:absent,sox:absent,vix:absent,moves:{sox:move,nas100:{date:'2026-10-09',previousDate:'2026-10-08',changePercent:1},extra:1},
  shock:{'2026-10-12':{sox:reading,nas100:{...reading,up:30,down:30},fear:{date:'2026-10-12',level:31,previousLevel:28}},'2026-10-13':{sox:reading},'2026-10-09':{sox:reading,nas100:null,fear:null}}},'2026-10-12');
 assert.deepEqual(safe.moves,{sox:move,nas100:null});
 // A reading dated on another session, counts that do not add up, or a session after the snapshot are dropped.
 assert.deepEqual(safe.shock,{'2026-10-12':{sox:reading,nas100:null,fear:{date:'2026-10-12',level:31,previousLevel:28}},'2026-10-09':{sox:null,nas100:null,fear:null}});
 assert.equal(safeThermometerSnapshot({asOf:'2026-10-12',nas100:absent,sox:absent,vix:absent},'2026-10-12').moves,undefined);
 const db=new PGlite();
 try{
  await db.exec(await readFile('scripts/resolute/thermometer-schema.sql','utf8'));
  await db.query('INSERT INTO resolute_thermometer_snapshots(session_date,snapshot) VALUES ($1,$2::jsonb)',['2026-10-12',JSON.stringify(safe)]);
  await db.query('INSERT INTO resolute_thermometer_snapshots(session_date,snapshot) VALUES ($1,$2::jsonb)',['2026-10-09',JSON.stringify({asOf:'2026-10-09'})]);
  const moves=await readSessionMoves(db,['2026-10-12','2026-10-09','2026-10-13','bad']);
  assert.deepEqual(moves['2026-10-12'],{sox:{previousDate:'2026-10-09',changePercent:move.changePercent,typicalPercent:1.2,up:3,down:36,total:40},fear:{level:31,previousLevel:28}});
  assert.deepEqual(moves['2026-10-09'],{fear:null});assert.equal(moves['2026-10-13'],undefined);
 }finally{await db.close();}
});

test('the thermometer measures the shock from its own baskets: median typical move over 60 sessions, constituents, fear index',()=>{
 const dates=[];for(let d=new Date('2026-06-01T00:00:00Z');dates.length<80;d.setUTCDate(d.getUTCDate()+1))if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
 // Twelve stocks alternate +1% / −1% (typical move 1%), then on the last day ten fall 6% and two rise 1%.
 const series={};for(let k=0;k<12;k++){let c=100;series['T'+k]=dates.map((date,i)=>{if(i){c*=i===dates.length-1?(k<10?0.94:1.01):(i%2?1.01:1/1.01);}return {date,close:c};});}
 const levels=equalWeightLevels(series),last=dates.at(-1);
 const shock=sessionShock(levels,series,last);
 assert.equal(shock.down,10);assert.equal(shock.up,2);assert.equal(shock.total,12);assert.ok(Math.abs(shock.typicalPercent-1)<0.01,String(shock.typicalPercent));
 assert.ok(Math.abs(shock.changePercent-(-4.83))<0.01,String(shock.changePercent));
 assert.equal(sessionShock(levels,series,dates[30]),null,'fewer than 60 earlier sessions: not measured');
 const fear=sessionFear(levels,last);assert.equal(fear.date,last);assert.ok(fear.level>fear.previousLevel);
 const m=measureDay(shock);assert.equal(m.multiple,4.9);assert.equal(m.same,10);
});

test('"filled at the next update": waiting stories in ready days get stars and an approved quote; legacy rows are left alone',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:dump});
 try{
  for(const f of ['001_entitlements.sql','009_risk.sql'])await db.exec(read('../db/resolute/'+f));
  const waiting=validateGeneration(clean,candidate),legacy={...waiting,facts:{source:'official'},stars:3};delete legacy.market;
  await db.query("INSERT INTO resolute.risk_days(day,state,articles) VALUES('2026-10-13','ready',$1),('2026-10-12','ready',$2),('2026-10-09','failed','[]')",[JSON.stringify([waiting]),JSON.stringify([legacy])]);
  const quote=(id,ja,approved=true)=>({id,approved,minStars:4,maxStars:5,ja:{title:ja,reasons:[]},en:{title:'Before you act, check the full story and your own rules.',reasons:[]}});
  await db.query('INSERT INTO resolute.risk_quotes(id,value) VALUES($1,$2),($3,$4),($5,$6)',['flagged',JSON.stringify(quote('flagged','見出しほど、中身は大きくありません。')),'draft',JSON.stringify(quote('draft','見出しだけで動かず、本文と自分のルールを確かめましょう。',false)),'ok',JSON.stringify(quote('ok','見出しだけで動かず、本文と自分のルールを確かめましょう。'))]);
  const now=new Date('2026-10-13T23:00:00Z');let asked=[];
  const none=await fillMarketReactions(db,async s=>{asked=s;return {};},now);
  assert.deepEqual(asked,['2026-10-12']);assert.deepEqual(none,{days:2,updated:0,waiting:1});
  const result=await fillMarketReactions(db,async()=>({'2026-10-12':{sox:mv(10.04,1.5,38,40),fear:{level:40,previousLevel:30}}}),now);
  assert.deepEqual(result,{days:2,updated:1,waiting:0});
  const [stored]=(await db.query("SELECT articles FROM resolute.risk_days WHERE day='2026-10-13'")).rows[0].articles;
  assert.equal(stored.stars,5);assert.deepEqual(stored.market.reading,{from:'2026-10-09',nas100:null,sox:{changePercent:10,multiple:6.7,same:38,total:40},fearChange:33});assert.equal(stored.quoteId,'ok');
  assert.equal((await db.query("SELECT articles FROM resolute.risk_days WHERE day='2026-10-12'")).rows[0].articles[0].stars,3);
  assert.deepEqual(await fillMarketReactions(db,async()=>({'2026-10-12':{sox:mv(-1)}}),now),{days:2,updated:0,waiting:0});
  // The public feed never shows a legacy (rubric) day, and never offers a quote that needs re-approval.
  const before=process.env.RESOLUTE_RISK_PUBLISH_APPROVED;process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
  try{
   await db.exec('UPDATE resolute.risk_control SET enabled=true WHERE id');
   const feed=await publicRiskFeed(db,false,new Date('2026-10-13T00:00:00Z'));assert.equal(feed.state,'ready');assert.deepEqual(feed.quotes.map(q=>q.id),['ok']);
   assert.equal((await publicRiskFeed(db,false,new Date('2026-10-12T00:00:00Z'))).state,'failed');
   const req=value=>new Request('https://service.test/internal/v1/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
   const refused=await riskRequest(req({action:'quote',quote:quote('flagged','見出しほど、中身は大きくありません。'),baseRevision:1}),OWNER_ACCOUNT_ID,async()=>({}),db);
   assert.equal(refused.status,422);assert.deepEqual((await refused.json()).codes,['importance']);
   assert.equal((await riskRequest(req({action:'quote',quote:quote('flagged','見出しだけで動かず、本文と自分のルールを確かめましょう。'),baseRevision:1}),OWNER_ACCOUNT_ID,async()=>({}),db)).status,200);
  }finally{if(before===undefined)delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;else process.env.RESOLUTE_RISK_PUBLISH_APPROVED=before;}
 }finally{await db.close();}
});

test('summary prompt: facts only, banned wording is rewritten once, then the story is withheld and only logged',async()=>{
 for(const word of ['一時的','影響は小さい','〜しそう','可能性が高い','買い時','売り時','警戒が必要'])assert.ok(SUMMARY_INSTRUCTIONS.includes(word),word);
 assert.ok(summaryIssues(banned.ja).includes('temporary'));assert.ok(summaryIssues(banned.ja).includes('impact-size'));assert.ok(summaryIssues(banned.ja).includes('appearance'));
 for(const text of ['この下げは一時的である可能性が高いです。','今が買い時です。','売り時です。','警戒が必要です。','This dip is likely temporary.','A buying opportunity.','Caution is needed.','The impact is small.'])assert.ok(summaryIssues(text).length,text);
 for(const text of [clean.ja.content,clean.en.content,'NVIDIAは売上高が12%増えたと発表しました。','The company cut its full-year outlook to 40 billion dollars.'])assert.deepEqual(summaryIssues(text),[],text);
 const env={key:process.env.RESOLUTE_OPENAI_API_KEY,limit:process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD};
 process.env.RESOLUTE_OPENAI_API_KEY='test-key';process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD='2';
 const pool={query:async()=>({rows:[{reserved_usd:0.1}]})},now=new Date('2026-10-12T22:00:00Z');
 const model=outputs=>{const bodies=[];const fetcher=async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{content:[{type:'output_text',text:JSON.stringify(outputs[bodies.length-1])}]}]});};return {fetcher,bodies};};
 try{
  let m=model([clean]);let article=await generate(candidate,pool,now,m.fetcher);assert.equal(m.bodies.length,1);assert.ok(article.ja.content.endsWith(SUMMARY_QUESTION.ja));
  m=model([banned,clean]);const lines=[];article=await generate(candidate,pool,now,m.fetcher,{log:l=>lines.push(l)});
  assert.equal(m.bodies.length,2);assert.match(m.bodies[1].instructions,/REWRITE/);assert.equal(article.ja.content.startsWith(clean.ja.content),true);assert.deepEqual(lines,[]);
  m=model([banned,banned]);article=await generate(candidate,pool,now,m.fetcher,{log:l=>lines.push(l)});
  assert.equal(article,null);assert.equal(m.bodies.length,2);assert.equal(lines.length,1);
  const line=JSON.parse(lines[0]);assert.equal(line.event,'RESOLUTE_RISK_SUMMARY_WITHHELD');assert.equal(line.articleId,candidate.id);assert.ok(line.codes.includes('temporary'));
  assert.ok(!lines[0].includes('NVIDIA')&&!lines[0].includes('一時的'));
  // Stars are never part of the model output.
  // Stars are never part of the model output; the model only reads the cause (one-off / lasting / unclear), which moves them one step at most.
  assert.deepEqual(Object.keys(m.bodies[0].text.format.schema.properties).sort(),['cause','en','ja','publishable']);
  assert.deepEqual(m.bodies[0].text.format.schema.properties.cause.properties.kind.enum,['one-off','lasting','unclear']);
 }finally{for(const [k,v] of [['RESOLUTE_OPENAI_API_KEY',env.key],['RESOLUTE_AI_MONTHLY_LIMIT_USD',env.limit]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('daily review stores a story that is still waiting for the market without choosing a RIZEL line',async()=>{
 const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));
 const saved=[];let selections=0,asked=null;
 const feed={ok:true,enabled:true,items:[{title:'Chip stocks face AI semiconductor risk warning',url:'https://example.com/shock',publishedAt:'2026-10-14T21:30:00Z',tickers:['NVDA'],bodyEn:'AI semiconductor companies warned of possible earnings declines over several months. The reported risk affects the sector, but the impact remains uncertain.'}]};
 try{
  const result=await prepareDailyReview({enabled:true,now:new Date('2026-10-14T23:00:00Z'),selectionPool:db,budgetPool:{query:async()=>({rows:[]})},publishPool:{query:async(sql,args)=>{if(sql.includes('risk_days'))saved.push(JSON.parse(args[2]));return {rows:[]};}},
   readFeed:async()=>feed,readMoves:async s=>{asked=s;return {};},
   summarize:async c=>{assert.deepEqual(c.tickers,['NVDA']);return validateGeneration({...clean,ja:{...clean.ja,content:'AI半導体企業が業績の下振れの可能性を警告しました。',date:'報道'},en:{...clean.en,content:'AI semiconductor companies warned of possible earnings declines.',date:'Reported'}},c);},
   select:async()=>{selections++;throw Error('must not select');}});
  assert.equal(result.state,'ready');assert.equal(result.count,1);assert.equal(result.waitingForMarket,1);assert.equal(result.rizelSelections,0);assert.equal(selections,0);
  assert.deepEqual(asked,['2026-10-15']);assert.equal(saved[0][0].stars,null);assert.equal(saved[0][0].market.index,'sox');
 }finally{await db.close();}
});

test('RIZEL lines: impact evaluation, outlook and trading actions need re-approval; the owner rewrites are the spec examples',async()=>{
 assert.equal(RIZEL_REWRITES['見出しほど、中身は大きくありません。'],'見出しだけで動かず、本文と自分のルールを確かめましょう。');
 assert.equal(rizelRewrite('I won’t trade on this news alone.','en'),'Before you act, check the full story and your own rules.');
 for(const text of ['見出しほど、中身は大きくありません。','I won’t trade on this news alone.','私はこのニュースでは動きません。','影響は限定的です。','今は買い時ではありません。'])assert.ok(rizelCopyIssues(text).length,text);
 for(const text of ['見出しだけで動かず、本文と自分のルールを確かめましょう。','Before you act, check the full story and your own rules.'])assert.deepEqual(rizelCopyIssues(text),[],text);
 // Every in-repo draft and owner preview line is a general mindset line.
 for(const q of [...RIZEL_QUOTE_DRAFTS,...Object.values(RISK_PREVIEW_DETAILS).map(d=>d.comment)])assert.deepEqual(quoteIssues(q),[],q.id);
 const entry=(id,text,en='Check your rules.')=>({id,kind:'conclusion',group:'A',revision:1,approval:'approved',publication:'withheld',text,textSha256:'h',english:{text:en,approval:'approved',textSha256:'h'}});
 const bank=[entry('A-conclusion-01','見出しほど、中身は大きくありません。'),entry('A-conclusion-02','見出しだけで動かず、本文と自分のルールを確かめましょう。'),entry('A-conclusion-03','ルールを確かめましょう。','I won’t trade on this news alone.')];
 assert.deepEqual(eligibleCopies(bank,{id:'n',revision:'v',stars:1,text:''},[]).map(e=>e.id),['A-conclusion-02']);
 const marked=markReapproval({...bank[0],english:{...bank[0].english,revision:1}});
 assert.equal(marked.needsReapproval,true);assert.equal(marked.suggestion.ja,'見出しだけで動かず、本文と自分のルールを確かめましょう。');assert.equal(marked.suggestion.en,null);
 assert.equal(markReapproval(bank[1]).needsReapproval,false);
 // Same approval flow; a replacement that still evaluates impact is refused before any write.
 const req=v=>new Request('https://service.test/internal/v1/rizel/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});
 const pool={connect:async()=>{throw Error('must not write');},query:async()=>{throw Error('must not write');}};
 const refused=await rizelReviewRequest(req({action:'approve-copy',id:'A-conclusion-01',locale:'ja',baseRevision:1,text:'見出しほど、中身は大きくありません。'}),OWNER_ACCOUNT_ID,null,pool);
 assert.equal(refused.status,422);
 const admin=read('../app/resolute/rizel-admin/screen.tsx');assert.ok(admin.includes('承認し直しが必要な文章'));assert.ok(admin.includes('（要再承認）'));assert.ok(admin.includes("action:'approve-copy'"));
});

test('wording: names, note under the stars, waiting text and the disclaimer are the reviewed texts in both languages',()=>{
 // Owner, Nov 25: the note under the stars uses the Terms 第20条4項 wording, and is no longer than the note it replaced.
 assert.equal(RISK_POLICY.note.ja,'★は、ニュースのあとの実際の指標の動きと記事の内容から、一過性かどうかを吟味して算出した目安であり、今後の値動きや売買の時期を示すものではありません。');
 assert.ok(readFileSync(new URL('../content/legal/terms.ja.md',import.meta.url),'utf8').includes('4. 衝撃度チェッカーの'+RISK_POLICY.note.ja.slice(0,-'ありません。'.length)));
 assert.ok([...RISK_POLICY.note.ja].length<=[...'★は、ニュースのあとに関連するTP指標が実際にどれだけ動いたかで決めています。今後の値動きを示すものではありません。売買の判断は、あなた自身でおこなってください。'].length);
 assert.equal(RISK_POLICY.note.en,'Stars weigh actual index moves after the news and whether the article’s cause looks one-off. They don’t show future prices or when to trade.');
 assert.ok(RISK_POLICY.note.en.length<='Stars show how much the related TP index actually moved after the news. They don’t predict future prices. Any decision to buy or sell is yours.'.length);
 assert.equal(RISK_POLICY.waiting.ja,'市場の反応待ち');assert.equal(RISK_POLICY.waiting.en,'Waiting for the market’s reaction');
 assert.equal(RIZEL_DISCLAIMER.ja,'本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。');
 assert.deepEqual(RISK_POLICY.indices,{sox:{ja:'TP半導体40',en:'TP Semiconductor 40'},nas100:{ja:'TP大型株100',en:'TP Large Cap 100'}});
 const gauge=read('../app/resolute/features/shock-gauge.tsx');assert.ok(gauge.includes("'衝撃度チェッカー'"));assert.ok(gauge.includes('>SHOCK GAUGE</small>'));assert.ok(gauge.includes("'Shock Gauge'"));
 const news=read('../app/resolute/news/screen.tsx');assert.ok(news.includes('<ShockGaugeTitle locale={locale} compact center/>')); // one line at 390px (owner, Nov 25)assert.ok(news.includes('RISK_POLICY.note'));assert.ok(!news.includes('RIZEL_DISCLAIMER'));assert.ok(news.includes('<ShockStars'));
 const owner=read('../app/resolute/news/owner/screen.tsx');assert.ok(owner.includes('<h1>衝撃度チェッカーの管理</h1>'));assert.ok(!/action:'(?:stars|setStars|rate)'/.test(owner));assert.ok(owner.includes('手で変える操作はありません'));
 // The home card keeps the name on one line (compact: 「SHOCK GAUGE」 moves above when the row is narrow).
 assert.ok(read('../app/resolute/home/screen.tsx').includes('<ShockGaugeTitle locale={locale} compact/>'));
 assert.ok(read('../app/resolute/tonight/screen.tsx').includes('<ShockGaugeTitle locale={locale}/>'));
 assert.ok(read('../app/resolute/tool-shell.tsx').includes('["/resolute/news","衝撃度チェッカー","Shock Gauge",'));
 for(const file of ['home/screen.tsx','news/screen.tsx','news/owner/screen.tsx','news/page.tsx','review/screen.tsx','tonight/screen.tsx','tool-shell.tsx','checkout/live-screen.tsx','lp/landing.tsx','lp/landing-en.tsx'])
  assert.ok(!/危険度|News Risk|news risk|Risk Checker|Risk level/.test(read('../app/resolute/'+file)),file);
 const lp=read('../app/resolute/lp/landing.tsx');assert.ok(lp.includes('<span className={s.miniLab}>衝撃度チェッカー</span><span className={s.miniEn}>SHOCK GAUGE</span>'));
});

test('display samples keep stars consistent with the sample moves and show the waiting state',()=>{
 for(const a of RISK_VISUAL_FIXTURE.articles)assert.deepEqual(parseRiskArticle(a),a);
 assert.equal(RISK_VISUAL_FIXTURE.articles[2].stars,null);
 for(const scenario of ['low','medium','high'])for(const a of reviewScenarioFeed(scenario).articles)assert.deepEqual(parseRiskArticle(a),a);
 assert.deepEqual(reviewScenarioFeed('high').articles.map(a=>a.stars),[4,5,4]);
});
