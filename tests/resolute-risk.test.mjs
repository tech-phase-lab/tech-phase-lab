import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {starsFromShock,measureShock,riskAction,parseRiskFeed,latestRiskDate,formatMove,formatShock,SUMMARY_QUESTION,starCriteria,noStarsLabel} from '../lib/resolute/risk.ts';
import {candidatesFromFeed,validateGeneration,collect,publish,isInDailyWindow} from '../services/resolute-api/risk-job.mjs';
import {saveRiskDay} from '../services/resolute-api/rizel-daily-review.mjs';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';
import {riskRequest,publicRiskFeed,hash} from '../services/resolute-api/risk-store.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
const now=new Date('2026-10-12T23:00:00Z');
const body='NVIDIA warned that export restrictions across the semiconductor sector could affect earnings for several months. The restrictions are planned, not completed.';
const candidate={id:hash('https://investor.nvidia.com/test'),title:'NVIDIA warns of export restrictions',body,url:'https://investor.nvidia.com/test',publishedAt:'2026-10-12T20:00:00Z',source:'official'};
const generated={publishable:true,ja:{title:'NVIDIAが輸出規制について警告',source:'NVIDIAの公式発表',content:'NVIDIAが、半導体業界への輸出規制が計画段階にあると発表しました。',date:'2026年10月12日の発表'},en:{title:'NVIDIA warns of export restrictions',source:'NVIDIA announcement',content:'NVIDIA said export restrictions across the semiconductor sector are planned, not completed.',date:'Announced on October 12, 2026'}};
const article=validateGeneration(generated,candidate);
const shock=(multiple,same,total,fearChange)=>({multiple,same,total,fearChange});
test('Shock Gauge stars are mechanical: the highest level whose every condition holds (multiple of the typical move, breadth, fear)',()=>{
 assert.deepEqual(RISK_POLICY.stars.levels,[{stars:5,multiple:5,breadth:80,fear:10},{stars:4,multiple:3,breadth:80,fear:null},{stars:3,multiple:2,breadth:70,fear:null},{stars:2,multiple:1.5,breadth:null,fear:null}]);
 assert.equal(RISK_POLICY.stars.typicalDays,60);assert.equal(RISK_POLICY.reviewMinStars,4);
 for(const [s,stars] of [[shock(0.6,20,40,0),1],[shock(1.4,40,40,50),1],[shock(1.5,0,40,null),2],[shock(2,28,40,0),3],[shock(2,27,40,0),2],[shock(3,32,40,0),4],[shock(3,31,40,0),3],
  [shock(5,32,40,10),5],[shock(5,32,40,9),4],[shock(5,32,40,null),4],[shock(9,31,40,40),3]])assert.equal(starsFromShock(s),stars,JSON.stringify(s));
 // Owner anchors (Nov 25), measured on the thermometer's own data: Nov 20 TP大型株100 −5.4% (6.0×, 47/55, fear +12%) ★5;
 // Nov 24 TP半導体40 −8.5% (3.8×, 39/40, fear 0%) ★4; an ordinary day ★1–2.
 assert.equal(starsFromShock(shock(6,47,55,12)),5);assert.equal(starsFromShock(shock(3.8,39,40,0)),4);assert.equal(starsFromShock(shock(1.1,30,55,1)),1);
 // Measured and rounded exactly as shown.
 assert.deepEqual(measureShock(-8.51,{typicalPercent:2.24,up:1,down:39,total:40},{level:60.1,previousLevel:60}),{multiple:3.8,same:39,total:40,fearChange:0});
 assert.deepEqual(measureShock(4.1,{typicalPercent:0.65,up:50,down:5,total:55},{level:33,previousLevel:29}),{multiple:6.3,same:50,total:55,fearChange:14});
 assert.deepEqual(measureShock(-1,{typicalPercent:1,up:3,down:30,total:40},null),{multiple:1,same:30,total:40,fearChange:null});
 assert.equal(riskAction(4),'review');assert.equal(riskAction(3),'none');assert.equal(riskAction(null),'none');assert.throws(()=>riskAction(0));
});
test('the published criteria text is generated from the levels, in both languages, and shown on the Shock Gauge page',()=>{
 assert.equal(starCriteria('ja'),'★の決め方：市場全体のニュースはTP大型株100、半導体のニュースはTP半導体40を、ニュースのあと最初の米国市場の終値で測ります。①ふだんの何倍動いたか（ふだん＝直前60営業日の1日の値動きの大きさの中央値）②構成銘柄のうち同じ向きに動いた割合 ③TP恐怖指数の上昇率。★5：5倍以上・80%以上・恐怖指数+10%以上。★4：3倍以上・80%以上。★3：2倍以上・70%以上。★2：1.5倍以上。それ以外は★1。1社だけのニュースには★をつけません。');
 assert.match(starCriteria('en'),/^How stars are set: .*★5: 5× or more, 80% or more, fear index \+10% or more\. ★4: 3× or more, 80% or more\. .* News about a single company gets no stars\.$/);
 assert.match(readFileSync(new URL('../app/resolute/news/screen.tsx',import.meta.url),'utf8'),/starCriteria\(en\?'en':'ja'\)/);
 const m={index:'sox',session:'2026-11-24',changePercent:-8.5,shock:shock(3.8,39,40,0)};
 assert.equal(formatMove(m,'ja'),'TP半導体40 −8.5%');assert.equal(formatShock(m,'ja'),'ふだんの3.8倍の下げ・40社中39社が下落・恐怖指数0%');
 assert.equal(formatShock({...m,changePercent:5.4,shock:shock(6,47,55,12)},'en'),'6.0× its typical move · 47 of 55 stocks up · fear index +12%');
 assert.equal(formatShock({...m,shock:shock(3.8,39,40,null)},'ja'),'ふだんの3.8倍の下げ・40社中39社が下落');
});
test('a new story waits for the market: no stars, its index and the first U.S. close after the news are recorded',()=>{
 // 2026-10-12T20:00Z is 16:00 New York time: exactly at the close, so it belongs to the next close.
 assert.equal(article.stars,null);assert.deepEqual(article.market,{index:'sox',session:'2026-10-13',changePercent:null,shock:null});
 assert.equal(formatMove(article.market,'ja'),null);
 // Stars always follow the current published rule for the stored shock: none without one. A day saved before Nov 25 (a move but
 // no measured shock) reads as waiting again and is measured on the next update; its RIZEL line is dropped.
 assert.equal(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:5}],quotes:[]}).articles[0].stars,null);
 const old=parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{index:'sox',session:'2026-10-13',changePercent:-8.5},stars:5,quoteId:'calm'}],quotes:[]}).articles[0];
 assert.deepEqual([old.market,old.stars,old.quoteId],[{index:'sox',session:'2026-10-13',changePercent:null,shock:null},null,null]);
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:7}],quotes:[]}));
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{...article.market,changePercent:-3.2,shock:shock(2.1,41,40,0)}}],quotes:[]}));
 const filled={...article,market:{...article.market,changePercent:-3.2,shock:shock(2.1,33,40,6)},stars:3,quoteId:'calm'};
 assert.deepEqual((({stars,quoteId})=>({stars,quoteId}))(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[filled],quotes:[]}).articles[0]),{stars:3,quoteId:'calm'});
 assert.equal(noStarsLabel(article,'ja'),'市場の反応待ち');
 assert.equal(formatMove(filled.market,'ja'),'TP半導体40 −3.2%');assert.equal(formatMove(filled.market,'en'),'TP Semiconductor 40 −3.2%');
 assert.equal(formatMove({index:'nas100',session:'2026-10-13',changePercent:0.4,shock:shock(0.5,60,100,0)},'en'),'TP Large Cap 100 +0.4%');
 // Legacy rubric fields are gone.
 assert.equal('facts' in article,false);
});
test('every summary ends with the exact closing question; new numbers still suppress generated copy',()=>{
 assert.ok(article.ja.content.endsWith('\n'+SUMMARY_QUESTION.ja));assert.ok(article.en.content.endsWith('\n'+SUMMARY_QUESTION.en));
 assert.equal(SUMMARY_QUESTION.ja,'このニュースで、あなたのルールの条件に当てはまるものはありますか？');assert.equal(SUMMARY_QUESTION.en,'Does anything in this news meet a condition in your rules?');
 // A model that already added the question does not get it twice.
 const twice=validateGeneration({...generated,ja:{...generated.ja,content:generated.ja.content+SUMMARY_QUESTION.ja}},candidate);
 assert.equal(twice.ja.content.split(SUMMARY_QUESTION.ja).length,2);
 assert.equal(validateGeneration({...generated,en:{...generated.en,content:'Profit falls 99%.'}},candidate),null);
 assert.equal(validateGeneration({...generated,publishable:false},candidate),null);
});
test('JST weekday publication boundary handles Monday before the morning run (08:00 JST), weekends, and Friday after it',()=>{assert.equal(latestRiskDate(new Date('2026-10-11T22:59:00Z')),'2026-10-09');assert.equal(latestRiskDate(new Date('2026-10-11T23:00:00Z')),'2026-10-12');assert.equal(latestRiskDate(new Date('2026-10-10T12:00:00Z')),'2026-10-09');});
test('collector excludes stale, partial, positive-only and headline-only items and canonicalizes duplicates',()=>{const a={...candidate,bodyEn:body,bodyJa:'半導体の輸出規制で業績に影響する可能性があると警告しました。'};const feed={ok:true,enabled:true,items:[],officialUpdates:[a,{...a,url:a.url+'?utm_source=test'},{...a,id:'partial',brief:{}},{...a,publishedAt:'2020-01-01',url:a.url+'/old'},{...a,bodyEn:null,bodyJa:null,url:a.url+'/title'}]};const result=candidatesFromFeed(feed,now);assert.equal(result.length,1);assert.equal(result[0].source,'official');assert.equal(candidatesFromFeed({...feed,enabled:false},now).length,1);});
test('risk store enforces notification ownership, owner identity, publication stop, hidden stories, daily claims and scoped SQL',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:dump});const pool={async query(sql,args){const r=await db.query(sql,args);return{...r,rowCount:r.rows.length||r.affectedRows};}};
 const before=process.env.RESOLUTE_RISK_PUBLISH_APPROVED;process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
 try{for(const f of ['001_entitlements.sql','009_risk.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 const req=(path,method='GET',value)=>new Request('https://service.test/internal/v1/risk'+path,{method,headers:{'Content-Type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
 assert.equal((await riskRequest(req(''),'user_paid',async()=>({canReceiveNotifications:false}),pool)).status,403);
 assert.equal((await riskRequest(req('/owner'),'user_other',async()=>({canReceiveNotifications:true}),pool)).status,403);
 assert.equal((await publicRiskFeed(pool,false,now)).state,'stopped');
 await db.exec('UPDATE resolute.risk_control SET enabled=true WHERE id');assert.equal((await publicRiskFeed(pool,false,now)).state,'preparing');assert.equal((await publicRiskFeed(pool,false,new Date(now.getTime()+2*3600000))).state,'failed');
 delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;assert.equal((await publicRiskFeed(pool,false,now)).state,'preparing');assert.equal((await publicRiskFeed(pool,false,new Date(now.getTime()+2*3600000))).state,'preparing');process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
 await collect(pool,{ok:true,enabled:true,items:[],officialUpdates:[{...candidate,bodyEn:body},{...candidate,title:'AI previous-day warning',url:candidate.url+'/previous',publishedAt:'2026-10-12T14:59:59Z',bodyEn:body}]},now);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM resolute.risk_candidates')).rows[0].count,2);
 let calls=0;const model=async()=>{calls++;return article;};assert.equal(await publish(pool,now,model),'ready');assert.equal(await publish(pool,now,model),'already-claimed');assert.equal(calls,1);
 assert.equal((await publicRiskFeed(pool,false,now)).articles.length,1);
 const hidden=await riskRequest(req('/owner','POST',{action:'hide',id:article.id}),OWNER_ACCOUNT_ID,async()=>({}),pool);assert.equal(hidden.status,200);assert.equal((await publicRiskFeed(pool,false,now)).state,'stopped');
 await db.exec('SET ROLE resolute_risk_writer');await assert.rejects(()=>db.query('UPDATE resolute.entitlements SET revoked_at=now()'),e=>e.code==='42501');await db.exec('RESET ROLE');
 const next=new Date('2026-10-13T23:00:00Z');await assert.rejects(()=>publish(pool,next,model),/RISK_JOB_FAILED/);assert.equal((await publicRiskFeed(pool,false,next)).state,'failed');
 }finally{if(before===undefined)delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;else process.env.RESOLUTE_RISK_PUBLISH_APPROVED=before;await db.close();}
});

test('official lane survives disabled general news without admitting disabled items or inventing dates',()=>{
 const a={...candidate,bodyEn:body};
 assert.equal(candidatesFromFeed({ok:true,enabled:false,items:[a],officialUpdates:[]},now).length,0);
 assert.equal(candidatesFromFeed({ok:true,enabled:false,items:[],officialUpdates:[{...a,publishedAt:undefined,publishedOn:'2026-10-12'}]},now).length,0);
 for(const feed of [
  {ok:false,enabled:false,items:[],officialUpdates:[a]},
  {ok:true,enabled:false,items:[]},
  {ok:true,enabled:false,items:[],officialUpdates:{}},
  {ok:true,enabled:'false',items:[],officialUpdates:[a]}
 ])assert.throws(()=>candidatesFromFeed(feed,now));
});

test('private date-only intake preserves dates and conservatively rejects future, stale and invalid dates',()=>{
 const item={...candidate,publishedAt:undefined,publishedOn:'2026-10-11',bodyEn:body};
 const feed=(a)=>({ok:true,enabled:false,items:[],officialUpdates:[a]});
 assert.equal(candidatesFromFeed(feed(item),now).length,0);
 const selected=candidatesFromFeed(feed(item),now,{allowDateOnly:true});
 assert.equal(selected.length,1);assert.equal(selected[0].publishedAt,'2026-10-11');
 const dated=validateGeneration({...generated,ja:{...generated.ja,date:'2026年10月11日の報道'},en:{...generated.en,date:'Reported on October 11, 2026'}},selected[0]);
 assert.equal(dated.publishedAt,'2026-10-11');
 // A date-only source uses the latest instant it could mean, so the first close is never before the news.
 assert.equal(dated.market.session,'2026-10-12');
 for(const date of ['2026-10-13','2026-10-01','2026-02-30','not-a-date'])
  assert.equal(candidatesFromFeed(feed({...item,publishedOn:date}),now,{allowDateOnly:true}).length,0);
 assert.equal(candidatesFromFeed(feed({...item,publishedAt:'invalid'}),now,{allowDateOnly:true}).length,0);
});

test('positive announcements are not risk candidates solely because their body mentions a risk',()=>{
 const feed={ok:true,enabled:true,items:[{...candidate,title:'NVIDIA expands partnership for safe automated driving',bodyEn:body}]};
 assert.deepEqual(candidatesFromFeed(feed,now),[]);
});

test('downside words do not match Urban, bandwidth or cutting-edge; inflections and downgrades remain eligible',()=>{
 const select=title=>candidatesFromFeed({ok:true,enabled:true,items:[{...candidate,title,bodyEn:body}]},now);
 for(const title of ['NVIDIA powers smarter Urban operations','NVIDIA expands bandwidth','NVIDIA introduces cutting-edge chips','NVIDIA introduces cutting edge chips','NVIDIA executive discusses chip design'])
  assert.equal(select(title).length,0,title);
 for(const title of ['NVIDIA faces export ban','NVIDIA banned from new market','NVIDIA warns of restrictions','NVIDIA shares fell','NVIDIA earnings decline','NVIDIA downgraded by analyst','NVIDIA faces losses','NVIDIA cuts outlook','NVIDIAの格下げ','NVIDIAの目標株価引下げ'])
  assert.equal(select(title).length,1,title);
});

test('a rebound headline does not hide concrete AI financing pressure in its body',()=>{
 const select=(title,bodyEn)=>candidatesFromFeed({ok:true,enabled:true,items:[{...candidate,title,bodyEn}]},now);
 // Synthetic paraphrases reproduce the October19 mixed-news failure without
 // copying a source article into fixtures or presenting it as a live feed.
 const financing='AI stocks recovered during the session. Analysts said higher borrowing costs could delay investment in data centers and pressure semiconductor suppliers.';
 assert.equal(select('AI stocks recover during the session',financing).length,1);
 const debt='CoreWeave shares recovered during the session. Its debt triggered a crisis of confidence among investors concerned about financing the AI infrastructure buildout.';
 assert.equal(select('CoreWeave shares recover',debt).length,1);
 for(const text of [
  'NVIDIA announced new AI data centers. The company expects strong investment demand and improved efficiency. Financing costs are discussed without any claim of pressure.',
  'AI stocks recovered during the session. Analysts denied that higher borrowing costs could delay investment in data centers and pressure semiconductor suppliers.',
  'NVIDIA announced an AI product for enterprise customers with new networking features and improved efficiency.\nForward-looking statements: higher borrowing costs could delay AI investments.',
  'Higher borrowing costs could delay investment in a grocery store. This company sells food and has reported an improved business outlook.\nNVIDIA released an AI processor.'
 ])assert.equal(select('NVIDIA announces new products',text).length,0,text);
});

test('daily window reaches back to the previous morning run (Monday: over the weekend); date-only dates keep their date',()=>{
 const tue=new Date('2026-10-12T22:00:00Z'); // Tue 07:00 JST
 assert.equal(isInDailyWindow('2026-10-12T14:00:00Z',tue),true);   // previous US session
 assert.equal(isInDailyWindow('2026-10-11T00:00:00Z',tue),false);  // too old
 assert.equal(isInDailyWindow('2026-10-13T00:00:00Z',tue),false);  // future
 assert.equal(isInDailyWindow('2026-10-12',tue),true);
 assert.equal(isInDailyWindow('2026-10-09',tue),false);
 const mon=new Date('2026-10-18T22:00:00Z'); // Mon 07:00 JST
 assert.equal(isInDailyWindow('2026-10-16T05:00:00Z',mon),true);   // Friday
 assert.equal(isInDailyWindow('2026-10-15T05:00:00Z',mon),false);
});

test('headlines about plunges, capex above expectations and supply delays are candidates; neutral ones are not',()=>{
 const select=title=>candidatesFromFeed({ok:true,enabled:true,items:[{...candidate,title,bodyEn:body}]},now);
 for(const title of ['NVIDIA plunges 9% as AI selloff deepens','Hyperscaler capex exceeds expectations, chip stocks slide','TSMC supply constraints delay AI chip shipments','エヌビディアが急落','半導体の供給制約が続く'])
  assert.equal(select(title).length,1,title);
 for(const title of ['NVIDIA launches new AI platform','NVIDIA hosts developer conference'])assert.equal(select(title).length,0,title);
});

test('risk days: quiet day is a ready empty list, failure is recorded, a ready day is never overwritten',async()=>{
 const rows=new Map(),pool={async query(sql,args){const [day,state,json]=args;const old=rows.get(day);if(!old||old.state!=='ready')rows.set(day,{state,articles:JSON.parse(json)});return{rows:[]};}};
 await saveRiskDay(pool,'2026-10-13',[],now);assert.deepEqual(rows.get('2026-10-13'),{state:'ready',articles:[]});
 await saveRiskDay(pool,'2026-10-13',null,now);assert.equal(rows.get('2026-10-13').state,'ready');
 await saveRiskDay(pool,'2026-10-14',null,now);assert.equal(rows.get('2026-10-14').state,'failed');
});

test('stopped vs preparing vs failed wording comes from the single policy',()=>{
 assert.equal(parseRiskFeed({state:'preparing',date:null,articles:[],quotes:[]}).state,'preparing');
 assert.equal(RISK_POLICY.status.preparing.ja,'準備中です');
 assert.equal(riskAction(RISK_POLICY.reviewMinStars),'review');
});

test('market-wide stress headlines become candidates even without AI/semiconductor words; neutral macro news does not',()=>{
 const macro='Investors worried that the Federal Reserve may keep interest rates high for longer, pressuring technology stocks and equity valuations across the market for months.';
 const select=(title,bodyEn=macro)=>candidatesFromFeed({ok:true,enabled:true,items:[{...candidate,title,bodyEn}]},now);
 for(const title of ['Nasdaq tumbles as Treasury yields surge','Wall Street sell-off deepens on tariff fears','Fed signals rate hikes could return, stocks slide'])assert.equal(select(title).length,1,title);
 for(const title of ['Fed holds rates steady as expected','Nasdaq hits record high','Local bakery opens new store'])assert.equal(select(title).length,0,title);
});
