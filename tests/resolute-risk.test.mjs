import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {starsFromShock,measureDay,fearChangeOf,readingStars,causeStars,riskAction,parseRiskFeed,latestRiskDate,formatReading,readingParts,formatCause,SUMMARY_QUESTION,starCriteria,starSummary,STAR_INFO_LABEL,noStarsLabel} from '../lib/resolute/risk.ts';
import {candidatesFromFeed,validateGeneration,collect,publish,isInDailyWindow} from '../services/resolute-api/risk-job.mjs';
import {saveRiskDay} from '../services/resolute-api/rizel-daily-review.mjs';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';
import {riskRequest,publicRiskFeed,hash} from '../services/resolute-api/risk-store.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
const now=new Date('2026-10-12T23:00:00Z');
const body='NVIDIA warned that export restrictions across the semiconductor sector could affect earnings for several months. The restrictions are planned, not completed.';
const candidate={id:hash('https://investor.nvidia.com/test'),title:'Chipmakers warn of export restrictions',body,url:'https://investor.nvidia.com/test',publishedAt:'2026-10-12T20:00:00Z',source:'official'};
const generated={publishable:true,ja:{title:'NVIDIAが輸出規制について警告',source:'NVIDIAの公式発表',content:'NVIDIAが、半導体業界への輸出規制が計画段階にあると発表しました。',date:'2026年10月12日の発表'},en:{title:'NVIDIA warns of export restrictions',source:'NVIDIA announcement',content:'NVIDIA said export restrictions across the semiconductor sector are planned, not completed.',date:'Announced on October 12, 2026'}};
const article=validateGeneration(generated,candidate);
// A down move unless given (the fear condition counts on a down move only).
const shock=(multiple,same,total,fearChange,changePercent=-1)=>({changePercent,multiple,same,total,fearChange});
test('Shock Gauge stars are mechanical: the highest level whose every condition holds (multiple of the typical move, breadth, fear)',()=>{
 assert.deepEqual(RISK_POLICY.stars.levels,[{stars:5,multiple:5,breadth:80,fear:10},{stars:4,multiple:3,breadth:80,fear:null},{stars:3,multiple:2,breadth:70,fear:null},{stars:2,multiple:1.5,breadth:null,fear:null}]);
 assert.equal(RISK_POLICY.stars.typicalDays,60);assert.equal(RISK_POLICY.reviewMinStars,4);
 for(const [s,stars] of [[shock(0.6,20,40,0),1],[shock(1.4,40,40,50),1],[shock(1.5,0,40,null),2],[shock(2,28,40,0),3],[shock(2,27,40,0),2],[shock(3,32,40,0),4],[shock(3,31,40,0),3],
  [shock(5,32,40,10),5],[shock(5,32,40,9),4],[shock(5,32,40,null),4],[shock(9,31,40,40),3]])assert.equal(starsFromShock(s),stars,JSON.stringify(s));
 // Owner, Nov 25: on an UP move the fear index does not count (it rises on big up days too): ★5 = ≥5× and ≥80% up.
 for(const [s,stars] of [[shock(5,32,40,null,1),5],[shock(5,32,40,-30,1),5],[shock(7.9,89,99,19,6),5],[shock(4.9,40,40,50,1),4],[shock(5,31,40,50,1),3]])assert.equal(starsFromShock(s),stars,'up '+JSON.stringify(s));
 // Owner anchors (Nov 25), measured on the thermometer's own data: Nov 20 TP大型株100 −5.4% (6.0×, 47/55, fear +12%) ★5;
 // Nov 24 TP半導体40 −8.5% (3.8×, 39/40, fear 0%) ★4; an ordinary day ★1–2.
 assert.equal(starsFromShock(shock(6,47,55,12)),5);assert.equal(starsFromShock(shock(3.8,39,40,0)),4);assert.equal(starsFromShock(shock(1.1,30,55,1)),1);
 // Measured and rounded exactly as shown.
 assert.deepEqual(measureDay({changePercent:-8.51,typicalPercent:2.24,up:1,down:39,total:40}),{changePercent:-8.5,multiple:3.8,same:39,total:40});
 assert.deepEqual(measureDay({changePercent:4.1,typicalPercent:0.65,up:50,down:5,total:55}),{changePercent:4.1,multiple:6.3,same:50,total:55});
 assert.equal(fearChangeOf({level:60.1,previousLevel:60}),0);assert.equal(fearChangeOf({level:33,previousLevel:29}),14);assert.equal(fearChangeOf(null),null);
 // Both indices are measured; the story's stars are the stronger of the two (owner, Nov 25).
 const both={from:'2026-11-23',nas100:{changePercent:-1.5,multiple:2,same:47,total:99},sox:{changePercent:-8.5,multiple:3.8,same:39,total:40},fearChange:0};
 assert.equal(readingStars(both),4);assert.equal(readingStars({...both,sox:null}),2);assert.equal(readingStars(null),null);
 // The model's reading of the cause moves the stars by one step at most, within 1–5; ★5 only from a market ★4.
 const off={kind:'one-off',ja:'システム障害',en:'system outage'},last={kind:'lasting',ja:'輸出規制の強化',en:'tighter export controls'};
 for(const [m,c,want] of [[4,null,4],[4,off,3],[1,off,1],[4,last,5],[3,last,4],[5,last,5],[null,last,null]])assert.equal(causeStars(m,c),want,`${m} ${c?.kind}`);
 assert.equal(riskAction(4),'review');assert.equal(riskAction(3),'none');assert.equal(riskAction(null),'none');assert.throws(()=>riskAction(0));
});
test('the published criteria text is plain, generated from the levels, in both languages, and shown on the Shock Gauge page',()=>{
 assert.equal(starCriteria('ja'),['★のつけ方',
  '・ニュースのあと、アメリカの市場が閉まったときの値で、TP大型株100とTP半導体40の両方を見ます。取引中や取引後に出たニュースは、次の取引日の値で見ます。大きく動いたほうで★を決めます。',
  '・★5：いつもの5倍以上動いた、8割以上の会社が同じ向きに動いた、下落のときは恐怖指数も1割以上上がった',
  '・★4：いつもの3倍以上動いた、8割以上の会社が同じ向きに動いた',
  '・★3：いつもの2倍以上動いた、7割以上の会社が同じ向きに動いた',
  '・★2：いつもの1.5倍以上動いた','・★1：それより小さい動き',
  '・「いつもの」は、市場が開いていた直前の60日の、1日の動きの大きさのまん中の値です。',
  '・そのうえで、AIが記事の内容だけを読み、原因が一過性とみられるときは★を1つ下げ、長引きやすいとみられるときは1つ上げます。★5になるのは、市場の動きだけで★4以上のときだけです。どちらとも言えないときは変えません。',
  '・1社だけのニュースは、その会社の株価がいつもの3倍以上、業界の指標もいつもの1.5倍以上、同じ向きに動いたときだけ、業界の指標で★を決めます。',
  '・同じ取引日の動きには、ニュース1つにだけ★をつけます。見出しと逆の向きに動いたときは★をつけません。'].join('\n'));
 assert.match(starCriteria('en'),/^How stars are set\n- After the news, we look at both TP Large Cap 100 and TP Semiconductor 40 at the U\.S\. market close \(news during or after trading hours: the next trading day's close\)\. The bigger shock sets the stars\.\n- ★5: moved 5 times its usual move or more, 80% or more of its stocks moved the same way, on a fall, the fear index also rose 10% or more\n/s);
 // Owner, Nov 25: no extra visible text. The short explanation and the levels open only from one small 「i」 next to 「衝撃度」.
 assert.equal(starSummary('ja'),'★は、ニュースのあとのTP大型株100とTP半導体40の実際の動き（いつもの何倍動いたか・同じ向きに動いた会社の割合・恐怖指数）と、記事の内容から一過性かどうかを吟味して算出しています。1社だけのニュースは、その会社と業界の指標の両方が大きく動いたときだけ★をつけます。');
 assert.match(starSummary('en'),/^Stars are calculated from how TP Large Cap 100 and TP Semiconductor 40 actually moved after the news .* weighing whether the cause looks one-off\. News about a single company gets stars only when both the company and its industry index moved strongly\.$/);
 const screen=readFileSync(new URL('../app/resolute/news/screen.tsx',import.meta.url),'utf8'),gauge=readFileSync(new URL('../app/resolute/features/shock-gauge.tsx',import.meta.url),'utf8');
 assert.ok(screen.includes("<span className={s.k}>{en?'Shock':'衝撃度'}<StarInfo locale={locale}/></span>"));
 assert.ok(!/starCriteria|starSummary/.test(screen),'nothing else on the page');
 assert.match(gauge,/aria-expanded=\{open\}[^]*\{open\?<span role="note"[^]*\{starSummary\(locale\)\+'\\n\\n'\+starCriteria\(locale\)\}/);
 assert.equal(STAR_INFO_LABEL.ja,'★のつけ方');
 const m={index:'sox',session:'2026-11-24',reading:{from:'2026-11-23',nas100:{changePercent:-1.5,multiple:2,same:47,total:99},sox:{changePercent:-8.5,multiple:3.8,same:39,total:40},fearChange:0}};
 assert.deepEqual(formatReading(m,'ja'),['TP半導体40 −8.5%（いつもの3.8倍・39/40社が下落）','TP大型株100 −1.5%（いつもの2.0倍・47/99社が下落）','恐怖指数 0%']);
 assert.deepEqual(formatReading({...m,index:'nas100'},'en'),['TP Large Cap 100 −1.5% (2.0× usual · 47/99 down)','TP Semiconductor 40 −8.5% (3.8× usual · 39/40 down)','Fear index 0%']);
 // Owner, Nov 25: each index line fits on one phone line, its parenthetical set a little smaller and never broken inside.
 assert.deepEqual(readingParts({...m,index:'nas100'},'ja'),[{text:'TP大型株100 −1.5%',detail:'（いつもの2.0倍・47/99社が下落）'},{text:'TP半導体40 −8.5%',detail:'（いつもの3.8倍・39/40社が下落）'},{text:'恐怖指数 0%'}]);
 assert.match(gauge,/readingParts\(article\.market,locale\)/);
 assert.match(gauge,/const detail:CSSProperties=\{whiteSpace:'nowrap',fontSize:'\.8em'/);
 assert.equal(formatCause({market:m,stars:3,cause:{kind:'one-off',ja:'システム障害',en:'system outage'}},'ja'),'一過性とみられる要因（システム障害）→ ★−1');
 assert.equal(formatCause({market:m,stars:5,cause:{kind:'lasting',ja:'輸出規制の強化',en:'tighter export controls'}},'en'),'Likely to last (tighter export controls) → ★+1');
 assert.equal(formatCause({market:m,stars:4,cause:null},'ja'),null);
});
test('a new story waits for the market: no stars, its index and the session after the news are recorded',()=>{
 // 2026-10-12T20:00Z is 16:00 New York time: after regular hours, so it is measured on the next full session.
 assert.equal(article.stars,null);assert.deepEqual(article.market,{index:'sox',session:'2026-10-13',reading:null});
 assert.deepEqual(formatReading(article.market,'ja'),[]);
 // Stars always follow the current published rule for the stored readings: none without one. A day saved before Nov 25 (one
 // index's move, no measured shock) reads as waiting again and is measured on the next update; its RIZEL line is dropped.
 assert.equal(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:5}],quotes:[]}).articles[0].stars,null);
 const old=parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{index:'sox',session:'2026-10-13',changePercent:-8.5},stars:5,quoteId:'calm'}],quotes:[]}).articles[0];
 assert.deepEqual([old.market,old.stars,old.quoteId],[{index:'sox',session:'2026-10-13',reading:null},null,null]);
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:7}],quotes:[]}));
 const reading={from:'2026-10-12',nas100:null,sox:{changePercent:-3.2,multiple:2.1,same:33,total:40},fearChange:6};
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{...article.market,reading:{...reading,sox:{...reading.sox,same:41}}}}],quotes:[]}));
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{...article.market,reading:{...reading,from:'2026-10-13'}}}],quotes:[]}));
 const filled={...article,market:{...article.market,reading},stars:3,quoteId:'calm'};
 assert.deepEqual((({stars,quoteId})=>({stars,quoteId}))(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[filled],quotes:[]}).articles[0]),{stars:3,quoteId:'calm'});
 // The cause is part of the stored story; the stars follow it.
 assert.equal(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...filled,cause:{kind:'one-off',ja:'システム障害',en:'system outage'}}],quotes:[]}).articles[0].stars,2);
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...filled,cause:{kind:'maybe',ja:'x',en:'x'}}],quotes:[]}));
 assert.equal(noStarsLabel(article,'ja'),'市場の反応待ち');
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
 for(const title of ['Fed holds rates steady as expected','Local bakery opens new store'])assert.equal(select(title).length,0,title);
 // Owner, Nov 25: up days are eligible (「暴落の夜も 急騰の夜も」): a broad rally or record high is a candidate too.
 assert.equal(select('Nasdaq hits record high').length,1);
});
