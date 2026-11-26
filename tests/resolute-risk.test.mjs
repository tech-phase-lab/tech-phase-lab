import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {bandStars,indexStars,stockStars,marketStars,measureDay,fearChangeOf,readingStars,riskAction,parseRiskFeed,latestRiskDate,formatReading,shockTable,SUMMARY_QUESTION,starCriteria,starSummary,STAR_INFO_LABEL,noStarsLabel} from '../lib/resolute/risk.ts';
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
const R=(nas,sox,fearChange=0)=>({from:'2026-11-24',nas100:nas,sox,fearChange});
const M=(changePercent,intraday)=>({changePercent,multiple:1,same:50,total:100,...(intraday!==undefined?{intraday:{changePercent:intraday,multiple:1,same:50}}:{})});
test('Shock Gauge stars come from the owner\'s table only (Nov 26): the larger of the close and the intraday extreme, the higher index',()=>{
 assert.deepEqual(RISK_POLICY.stars.bands,{nas100:[1,2,3.5,5],sox:[1.6,3.2,5.6,8],stock:[2,4,7,10]});assert.equal(RISK_POLICY.stars.fearBump,20);
 for(const [move,want] of [[0.99,1],[1,2],[1.99,2],[2,3],[3.49,3],[3.5,4],[4.99,4],[5,5],[12,5]])assert.equal(bandStars(move,RISK_POLICY.stars.bands.nas100),want,String(move));
 for(const [move,want] of [[1.59,1],[1.6,2],[3.2,3],[5.6,4],[7.9,4],[8,5]])assert.equal(bandStars(move,RISK_POLICY.stars.bands.sox),want,String(move));
 for(const [move,want] of [[1.9,1],[2,2],[4,3],[7,4],[10,5]])assert.equal(bandStars(move,RISK_POLICY.stars.bands.stock),want,String(move));
 // Owner check, Nov 25: TP大型株100 −0.6% close, −4.6% intraday → ★4; TP半導体40 −1.8% / −7.9% → ★4; the day ★4 (fear +12%: no bump).
 assert.equal(indexStars('nas100',M(-0.6,-4.6)),4);assert.equal(indexStars('sox',M(-1.8,-7.9)),4);
 assert.equal(readingStars(R(M(-0.6,-4.6),M(-1.8,-7.9),12)),4);
 // The close alone when there is no intraday figure, and whichever is larger.
 assert.equal(indexStars('nas100',M(-2.4)),3);assert.equal(indexStars('nas100',M(-5.2,-3)),5);
 // The fear index up 20% or more adds ★1 on a down day only, ★5 at most.
 assert.equal(readingStars(R(M(-2.4),null,20)),4);assert.equal(readingStars(R(M(-2.4),null,19)),3);
 assert.equal(readingStars(R(M(2.4),null,25)),3,'never on an up day');assert.equal(readingStars(R(M(-6),null,40)),5);
 // Single-company news: the higher of the stock's row and its industry index's row.
 const company=(stock,basket,fear=0)=>({index:'company',session:'2026-11-25',company:{ticker:'NVDA',basket:'sox'},reading:{...R(null,basket,fear),company:stock}});
 assert.equal(marketStars(company({changePercent:-3.1,multiple:1,intraday:-9.4},M(-1.8,-7.9))),4); // NVDA 9.4% → ★4; TP半導体40 7.9% → ★4
 assert.equal(marketStars(company({changePercent:-3.1,multiple:1,intraday:-5.8},M(-1.8,-4.2))),3); // NVDA 5.8% → ★3; TP半導体40 4.2% → ★3
 assert.equal(marketStars(company({changePercent:-1,multiple:1},M(-0.5))),1);
 assert.equal(stockStars({changePercent:12,multiple:1}),5);
 assert.equal(readingStars(null),null);
 // Measured and rounded exactly as shown.
 assert.deepEqual(measureDay({changePercent:-8.51,typicalPercent:2.24,up:1,down:39,total:40}),{changePercent:-8.5,multiple:3.8,same:39,total:40});
 assert.equal(fearChangeOf({level:60.1,previousLevel:60}),0);assert.equal(fearChangeOf({level:33,previousLevel:29}),14);assert.equal(fearChangeOf(null),null);
 assert.equal(riskAction(4),'review');assert.equal(riskAction(3),'none');assert.equal(riskAction(null),'none');assert.throws(()=>riskAction(0));
});
test('the published criteria text is plain, generated from the levels, in both languages, and shown on the Shock Gauge page',()=>{
 // Owner, Nov 26 spec §1: the 「i」 text describes the table plainly, in the owner's words.
 assert.equal(starCriteria('ja'),['★のつけ方',
  '・TP大型株100とTP半導体40のそれぞれで、終値の動きと取引中のいちばん大きな動きのうち大きいほうで決めます。2つの指標のうち★が多いほうがその日の★です。',
  '・TP大型株100：★1 1%未満、★2 1〜2%、★3 2〜3.5%、★4 3.5〜5%、★5 5%以上',
  '・TP半導体40：★1 1.6%未満、★2 1.6〜3.2%、★3 3.2〜5.6%、★4 5.6〜8%、★5 8%以上',
  '・1社だけのニュースは、その会社の株価の動きで決めます：★1 2%未満、★2 2〜4%、★3 4〜7%、★4 7〜10%、★5 10%以上',
  '・恐怖指数が前の日より20%以上上がった日は、★を1つ足します。★5が上限です。',
  '・ニュースが出る前に起きた動きは数えません。見出しと逆の向きに動いたニュースは載せません。',
  '・どのニュースを載せるかは、毎朝AIが市場のまとめ記事とニュースを読み、市場を動かしたものを3つまで選びます。市場全体のニュースを優先します。★の数はAIでは変えません。'].join('\n'));
 assert.match(starCriteria('en'),/^How stars are set\n- For each of TP Large Cap 100 and TP Semiconductor 40, we take the larger of the close move and the largest move during trading/);
 assert.ok(starSummary('ja').includes('終値の動きと取引中のいちばん大きな動きのうち大きいほうで決め、2つの指標のうち★が多いほうをとります。恐怖指数が20%以上上がった日は★を1つ足します。'));
 const screen=readFileSync(new URL('../app/resolute/news/screen.tsx',import.meta.url),'utf8'),gauge=readFileSync(new URL('../app/resolute/features/shock-gauge.tsx',import.meta.url),'utf8');
 assert.ok(screen.includes("<span className={s.k}>{en?'Shock':'衝撃度'}<StarInfo locale={locale}/></span>"));
 assert.ok(!/starCriteria|starSummary/.test(screen),'nothing else on the page');
 assert.match(gauge,/aria-expanded=\{open\}[^]*\{open\?<span role="note"[^]*\{starSummary\(locale\)\+'\\n\\n'\+starCriteria\(locale\)\}/);
 assert.equal(STAR_INFO_LABEL.ja,'★のつけ方');
 // Owner, Nov 26 spec §3: the card's small table, 終値 and 一番下げた時 (一番上げた時 on an up day), − and + (never ▼▲).
 const m={index:'nas100',session:'2026-11-25',reading:{from:'2026-11-24',nas100:{changePercent:-0.6,multiple:1,same:80,total:100,intraday:{changePercent:-4.6,multiple:5,same:80}},sox:{changePercent:-1.8,multiple:1,same:30,total:40,intraday:{changePercent:-7.9,multiple:3,same:36}},fearChange:12}};
 assert.deepEqual(shockTable(m,'ja'),{close:'終値',extreme:'一番下げた時',rows:[
  {label:'TP大型株100',close:'−0.6%',extreme:'−4.6%',tone:'down'},{label:'TP半導体40',close:'−1.8%',extreme:'−7.9%',tone:'down'},{label:'恐怖指数',close:'+12%',extreme:'−',tone:null,fear:true}]});
 const up={...m,reading:{...m.reading,nas100:{...m.reading.nas100,changePercent:1.2,intraday:{changePercent:3.4,multiple:3,same:60}},sox:null,fearChange:9}};
 assert.deepEqual(shockTable(up,'en'),{close:'Close',extreme:'Intraday high',rows:[{label:'TP Large Cap 100',close:'+1.2%',extreme:'+3.4%',tone:'up'}]});
 assert.deepEqual(formatReading(m,'ja'),['TP大型株100\u3000終値 −0.6%\u3000一番下げた時 −4.6%','TP半導体40\u3000終値 −1.8%\u3000一番下げた時 −7.9%','恐怖指数\u3000+12%']);
 const card=readFileSync(new URL('../app/resolute/features/shock-card.tsx',import.meta.url),'utf8');
 assert.ok(!/[▼▲]/.test(card+JSON.stringify(shockTable(m,'ja'))));
});
test('a new story waits for the market: no stars, its index and the session after the news are recorded',()=>{
 // 2026-10-12T20:00Z is 16:00 New York time: after regular hours, so it is measured on the next full session.
 assert.equal(article.stars,null);assert.deepEqual(article.market,{index:'sox',session:'2026-10-13',reading:null});
 assert.deepEqual(formatReading(article.market,'ja'),[]);
 // Stars always follow the current published rule for the stored readings: none without one. A day saved before Nov 25 (one
 // index's move, no measured shock) reads as waiting again and is measured on the next update; its RIZEL line is dropped.
 const all={shownOnly:false};
 assert.equal(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:5}],quotes:[]},all).articles[0].stars,null);
 // Owner, Nov 26: members never see a waiting story; the feed shows only measured stories with stars.
 assert.deepEqual(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:5}],quotes:[]}).articles,[]);
 const old=parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{index:'sox',session:'2026-10-13',changePercent:-8.5},stars:5,quoteId:'calm'}],quotes:[]},all).articles[0];
 assert.deepEqual([old.market,old.stars,old.quoteId],[{index:'sox',session:'2026-10-13',reading:null},null,null]);
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:7}],quotes:[]}));
 const reading={from:'2026-10-12',nas100:null,sox:{changePercent:-3.2,multiple:2.1,same:33,total:40},fearChange:6};
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{...article.market,reading:{...reading,sox:{...reading.sox,same:41}}}}],quotes:[]}));
 assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,market:{...article.market,reading:{...reading,from:'2026-10-13'}}}],quotes:[]}));
 const filled={...article,market:{...article.market,reading},stars:3,quoteId:'calm'};
 assert.deepEqual((({stars,quoteId})=>({stars,quoteId}))(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[filled],quotes:[]}).articles[0]),{stars:3,quoteId:'calm'});
 // The cause is stored with the story but never changes the stars (owner, Nov 26: no AI ±1).
 assert.equal(parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...filled,cause:{kind:'one-off',ja:'システム障害',en:'system outage'}}],quotes:[]}).articles[0].stars,3);
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
 // The published story is still waiting for its session: the owner sees it, members do not (owner, Nov 26).
 assert.equal((await publicRiskFeed(pool,true,now)).articles.length,1);assert.equal((await publicRiskFeed(pool,false,now)).articles.length,0);
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
