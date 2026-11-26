import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {liveRelease,normalizePeriod,parseAmount,parsePerShare,releaseDay,flashTiles,tileAmount,guidanceRange,sectionReport} from '../lib/research/company-earnings-live.ts';
import {loadCompanyDive} from '../lib/research/company-dive-loader.ts';

// Production flashes as the monitor stored them (GET /api/research/earnings-results, Nov 26), trimmed to the fields used.
const NVDA={researchId:'ir-flash-143875704296938',kind:'earnings',ticker:'NVDA',period:'Q3 FY2027',url:'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/nvda-20261117.htm',publisher:'NVIDIA IR',publishedAt:'2026-11-17T21:22:03.895+00:00',method:null,
 facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$115.8B',comparisons:{yearAgo:'$57B'}},{key:'gross-margin',ja:'粗利益率',en:'Gross margin',value:'74.8%',comparisons:{yearAgo:'73.4%'}},
  {key:'eps',ja:'EPS（希薄化後）',en:'Diluted EPS',value:'$2.70',comparisons:{yearAgo:'$1.30'}},{key:'adjusted-eps',ja:'調整後EPS（希薄化後）',en:'Adjusted diluted EPS',value:'$2.68',comparisons:{yearAgo:'$1.27'}},{key:'net-income',ja:'純損益',en:'Net income / (loss)',value:'$65.3B',comparisons:{yearAgo:'$31.9B'}},
  {key:'guidance-revenue',ja:'次四半期見通し 売上高',en:'Next-quarter guidance Revenue',value:'$130.0B ± 3%'}]};
const ARM={researchId:'ir-flash-1492450087599',kind:'earnings',ticker:'ARM',period:'Q2 FYE27',url:'https://www.sec.gov/Archives/edgar/data/1973239/000197323926000141/exhibit992fye27q230-sepx26.htm',publisher:'Arm IR (SEC 6-K)',publishedAt:'2026-11-04T21:02:18.000+00:00',
 facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$1.443B',comparisons:{yearAgo:'$1.135B'}},{key:'eps',ja:'EPS（希薄化後）',en:'Diluted EPS',value:'$0.12',comparisons:{yearAgo:'$0.22'}},{key:'net-income',ja:'純損益',en:'Net income / (loss)',value:'$130M',comparisons:{yearAgo:'$238M'}}]};
const SKHY={researchId:'ir-flash-175395126363398',kind:'earnings',ticker:'SKHY',period:'Q3 2026',url:'https://www.sec.gov/Archives/edgar/data/2120882/000119312526434994/d162547d6k.htm',publisher:'SK hynix IR (SEC 6-K)',publishedAt:'2026-10-28T00:00:00.000+00:00',
 facts:[{key:'revenue',ja:'売上高（暫定・兆ウォン）',en:'Revenue (preliminary, KRW trillion)',value:'₩104.615483T',comparisons:{yearAgo:'₩24.448929T'}},{key:'operating-income',ja:'営業利益（暫定・兆ウォン）',en:'Operating profit (preliminary, KRW trillion)',value:'₩83.333818T'}]};
const NOW=Date.parse('2026-11-26T12:00:00Z');
// The page's file one quarter earlier than the flash.
const shownNVDA={ticker:'NVDA',period:'Q2 FY2027',releasedOn:'2026-08-26',currency:'USD'};

test('labels and figures read exactly as the release printed them',()=>{
 assert.equal(normalizePeriod('Q2 FYE27'),'Q2 FY2027');assert.equal(normalizePeriod('Q3 FY2027'),'Q3 FY2027');assert.equal(normalizePeriod('Q3 2026'),'Q3 2026');
 assert.equal(normalizePeriod('FQ4 2026'),null);assert.equal(normalizePeriod('third quarter'),null);assert.equal(normalizePeriod(null),null);
 assert.deepEqual(parseAmount('$115.8B'),{currency:'USD',millions:115800});assert.deepEqual(parseAmount('$-37.5M'),{currency:'USD',millions:-37.5});
 assert.deepEqual(parseAmount('NT$1494.243B'),{currency:'TWD',millions:1494243});assert.equal(parseAmount('₩104.615483T').currency,'KRW');
 assert.equal(parseAmount('$130.0B ± 3%'),null);assert.equal(parseAmount('€14.2B-€15.2B'),null);assert.equal(parseAmount('about $5B'),null);
 assert.deepEqual(parsePerShare('$2.70'),{currency:'USD',value:2.7});assert.equal(parsePerShare('$2.70B'),null);
 assert.equal(releaseDay('2026-11-17T21:22:03.895+00:00'),'2026-11-17');
 assert.equal(releaseDay('2026-10-28T00:00:00.000+00:00'),'2026-10-28','a date-only stamp keeps its own date, not New York\'s previous day');
 assert.equal(releaseDay('2026-11-03T02:10:00Z'),'2026-11-02','an evening release in New York is filed under that day');
});

test('a newer issuer-table flash replaces the file\'s quarter at the top of the page with the release\'s own figures',()=>{
 const {release,hold}=liveRelease([NVDA],shownNVDA,NOW);
 assert.equal(hold,null);
 assert.equal(release.period,'Q3 FY2027');assert.equal(release.releasedOn,'2026-11-17');assert.equal(release.sourceUrl,NVDA.url);
 assert.deepEqual(release.tiles.map(t=>t.label.ja),['売上高','粗利益率','次四半期見通し 売上高']);
 assert.deepEqual(release.tiles[0].value,{ja:'1,158億ドル',en:'$115.80B'});
 assert.deepEqual(release.tiles[0].note,{ja:'前年同期 570億ドル',en:'Prior-year quarter $57.00B'});
 assert.deepEqual(release.tiles[1].value,{ja:'74.8%',en:'74.8%'});
 assert.deepEqual(release.tiles[2].value,{ja:'$130.0B ± 3%',en:'$130.0B ± 3%'},'a guidance band is shown exactly as printed');
 assert.deepEqual(release.tiles[2].note,{ja:'会社予想',en:'Company guidance'});
});

test('the fiscal label of a foreign issuer and its own currency are kept; a date-only filing day is not moved',()=>{
 const arm=liveRelease([ARM],{ticker:'ARM',period:'Q1 FY2027',releasedOn:'2026-07-30',currency:'USD'},NOW).release;
 assert.equal(arm.period,'Q2 FY2027');assert.deepEqual(arm.tiles.map(t=>t.value.ja),['14.43億ドル','0.12ドル','1.3億ドル']);
 const sk=liveRelease([SKHY],{ticker:'SKHY',period:'Q2 2026',releasedOn:'2026-07-23',currency:'KRW'},NOW).release;
 assert.equal(sk.releasedOn,'2026-10-28');assert.equal(sk.tiles[0].value.ja,'104.62兆ウォン');assert.equal(sk.tiles[0].label.ja,'売上高（暫定・兆ウォン）');
});

test('nothing newer: the page keeps its file (the same release, the same quarter, a future time, another company)',()=>{
 assert.deepEqual(liveRelease([NVDA],{...shownNVDA,period:'Q3 FY2027',releasedOn:'2026-11-17'},NOW),{release:null,hold:null});
 assert.deepEqual(liveRelease([NVDA],{...shownNVDA,releasedOn:'2026-11-12'},NOW),{release:null,hold:null},'within a week is the same release');
 assert.deepEqual(liveRelease([NVDA],shownNVDA,Date.parse('2026-11-17T21:00:00Z')),{release:null,hold:null});
 assert.deepEqual(liveRelease([{...NVDA,ticker:'AMD'}],shownNVDA,NOW),{release:null,hold:null});
 assert.deepEqual(liveRelease(null,shownNVDA,NOW),{release:null,hold:null},'the monitor did not answer');
});

test('accuracy: anything not read from the release table, or read uncertainly, is held and never shown',()=>{
 const held=(brief,shown=shownNVDA)=>liveRelease([brief],shown,NOW);
 assert.equal(held({...NVDA,researchId:'ir-announce-1',facts:[]}).hold,'not-issuer-table');
 assert.equal(held({...NVDA,researchId:'ir-fallback-1',method:'deep-analysis-verified-figures'}).hold,'not-issuer-table','figures read back from a model-written article');
 assert.equal(held({...NVDA,method:'issuer-highlight-sentences'}).hold,'not-issuer-table');
 assert.equal(held({...NVDA,period:'third quarter'}).hold,'period-unreadable');
 assert.equal(held({...NVDA,url:'https://example.com/nvda.htm'}).hold,'source-host');
 assert.equal(held({...NVDA,url:'http://www.sec.gov/x.htm'}).hold,'source-host');
 assert.equal(held({...NVDA,facts:NVDA.facts.filter(f=>f.key!=='revenue')}).hold,'figures-unreadable');
 assert.equal(held(NVDA,{...shownNVDA,currency:'EUR'}).hold,'figures-unreadable','never converted between currencies');
 assert.equal(held({...NVDA,facts:[NVDA.facts[0]]}).hold,'figures-unreadable','one figure is not a results section');
 assert.equal(held({...NVDA,facts:[{...NVDA.facts[0],value:'$115.8 billion'},...NVDA.facts.slice(1)]}).hold,'figures-unreadable');
});

test('the newest release decides: its table flash is used beside its announced line, and a held one never lets an older quarter in',()=>{
 const announce={...NVDA,researchId:'ir-announce-9',publishedAt:'2026-11-17T21:20:30.000+00:00',facts:[]};
 assert.equal(liveRelease([announce,NVDA],shownNVDA,NOW).release.period,'Q3 FY2027');
 const older={...NVDA,period:'Q2 FY2027',publishedAt:'2026-08-26T20:30:00.000+00:00'};
 const onlyAnnounced={...announce,publishedAt:'2026-11-17T21:20:30.000+00:00'};
 assert.deepEqual(liveRelease([onlyAnnounced,older],{...shownNVDA,period:'Q1 FY2027',releasedOn:'2026-05-20'},NOW),{release:null,hold:'not-issuer-table'});
});

test('the second tile falls back from the margin to the EPS, the third from the outlook to a profit line',()=>{
 const tiles=flashTiles(ARM.facts,'USD');
 assert.deepEqual(tiles.map(t=>t.label.en),['Revenue','Diluted EPS','Net income / (loss)']);
 assert.deepEqual(tiles[2].note,{ja:'前年同期 2.38億ドル',en:'Prior-year quarter $238M'});
});

test('the company page and the patrol route read the newer quarter on the server and the dive keeps its own quarter',()=>{
 const page=fs.readFileSync(new URL('../app/research/companies/[ticker]/page.tsx',import.meta.url),'utf8');
 assert.match(page,/loadLiveRelease\(\{ ticker, period: dive\.period, releasedOn: dive\.releasedOn, currency: dive\.currency \}\)/);
 assert.match(page,/newerReport\(ticker, live\?\.releasedOn \?\? shown\.releasedOn\)/);
 const view=fs.readFileSync(new URL('../app/research/companies/company-watch.tsx',import.meta.url),'utf8');
 assert.match(view,/<LatestHeading period=\{top\.period\}/);
 assert.match(view,/live=\{\{period:view\.period,releasedOn:view\.releasedOn/,'the deep dive is labelled with the file\'s own quarter');
 const server=fs.readFileSync(new URL('../lib/research/company-earnings-live.server.ts',import.meta.url),'utf8');
 assert.match(server,/const TTL_MS = 60_000;/,'one shared read a minute, never one per reader');
 const route=fs.readFileSync(new URL('../app/api/research/company-earnings/route.ts',import.meta.url),'utf8');
 assert.match(route,/sectionReport\(dive, decision, briefs\)/);assert.match(route,/s-maxage=60/);
 const config=fs.readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');
 assert.match(config,/"\/api\/research\/company-earnings": \["\.\/lib\/research\/dives\/\*\.json"\]/);
});

test('tile amounts carry their rounding; guidance reads a band, a range or one amount with its currency',()=>{
 assert.deepEqual(tileAmount('$115.8B'),{currency:'USD',millions:115800,tolerance:50});
 assert.deepEqual(tileAmount('NT$1,494.24B'),{currency:'TWD',millions:1494240,tolerance:5});
 assert.equal(tileAmount('$584.9M').tolerance,0.05);assert.equal(tileAmount('−$190.4M').millions,-190.4);
 assert.equal(tileAmount('100%超'),null);assert.equal(tileAmount('$60B–$63B'),null);
 const band=guidanceRange('$130.0B ± 3%');assert.equal(band.currency,'USD');assert.ok(Math.abs(band.low-126100)<1e-6&&Math.abs(band.high-133900)<1e-6);
 assert.deepEqual(guidanceRange('€14.2B-€15.2B'),{currency:'EUR',low:14200,high:15200});
 assert.deepEqual(guidanceRange('$65B'),{currency:'USD',low:65000,high:65000});
 assert.equal(guidanceRange('$1B-€2B'),null);assert.equal(guidanceRange('flat'),null);
});

test('the patrol report: the committed NVDA dive agrees with its section and with the monitor\'s reading of the same release',()=>{
 const dive=loadCompanyDive('NVDA');
 const same=sectionReport(dive,liveRelease([NVDA],{ticker:'NVDA',period:dive.period,releasedOn:dive.releasedOn,currency:dive.currency},NOW),[NVDA]);
 assert.equal(same.section.from,'dive');assert.equal(same.section.period,'Q3 FY2027');
 assert.deepEqual(same.checks,{diveCurrent:true,diveRevenue:true,flashRevenue:true,flashEps:true,flashGuidance:true});
 assert.ok(!JSON.stringify(same).includes('summary'),'the dive\'s own analysis never leaves the server');
 // A release read with another revenue, EPS or outlook is a mismatch.
 const wrong={...NVDA,facts:NVDA.facts.map(f=>f.key==='revenue'?{...f,value:'$118.8B'}:f.key==='adjusted-eps'?{...f,value:'$2.10'}:f.key==='guidance-revenue'?{...f,value:'$140.0B ± 2%'}:f)};
 assert.deepEqual(sectionReport(dive,{release:null,hold:null},[wrong]).checks,{diveCurrent:true,diveRevenue:true,flashRevenue:false,flashEps:false,flashGuidance:false});
 // A newer quarter on the page and the old dive below it: the dive is no longer current.
 const next={...NVDA,period:'Q4 FY2027',publishedAt:'2027-02-25T21:20:00.000+00:00'};
 const later=sectionReport(dive,liveRelease([next,NVDA],{ticker:'NVDA',period:dive.period,releasedOn:dive.releasedOn,currency:dive.currency},Date.parse('2027-02-26T00:00:00Z')),[next,NVDA]);
 assert.equal(later.section.from,'live');assert.equal(later.section.period,'Q4 FY2027');assert.equal(later.checks.diveCurrent,false);assert.equal(later.checks.diveRevenue,null);
 // No reading of the release stored: not comparable, not a pass.
 assert.equal(sectionReport(dive,{release:null,hold:null},[]).checks.flashRevenue,null);
});

test('a reported EPS in the file is compared with the release\'s diluted EPS, an adjusted one with the adjusted EPS',()=>{
 const asml=loadCompanyDive('ASML');
 const flash={researchId:'ir-flash-1',kind:'earnings',ticker:'ASML',period:'Q3 2026',url:'https://www.sec.gov/x.htm',publishedAt:'2026-10-14T10:01:18.000+00:00',
  facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'€11.662B'},{key:'eps',ja:'EPS（基本）',en:'Basic EPS',value:'€12.95'},{key:'adjusted-eps',ja:'x',en:'x',value:'€99.00'}]};
 assert.equal(sectionReport(asml,{release:null,hold:null},[flash]).checks.flashEps,true);
});
