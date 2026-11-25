// Owner, Nov 25 (resolute-pc-1125 §1–§3, resolute-mobile-all-1125 01 ホーム): the home on a phone and on a PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readingParts} from '../lib/resolute/risk.ts';
import {withRizelLine} from '../lib/resolute/rizel-line.ts';
import {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {safeTrail,safeThermometerSnapshot} from '../lib/resolute/thermometer-runtime.ts';
import {basketTrail,TRAIL_SESSIONS} from '../lib/resolute/thermometer-provider.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

const reading=(sox,nas,fear)=>({index:'sox',session:'2026-11-24',reading:{from:'2026-11-21',sox:{changePercent:sox,multiple:6.5,same:40,total:40},nas100:{changePercent:nas,multiple:7.9,same:89,total:99},fearChange:fear}});
test('home cards use the shared index lines (#873): no fear index line on an up move, kept on a down move',()=>{
 assert.ok(!readingParts(reading(14.7,6,19),'ja').some(l=>l.text.startsWith('恐怖指数')));
 assert.equal(readingParts(reading(-8.5,-1.5,0),'ja').at(-1).text,'恐怖指数 0%');
 const section=read('app/resolute/home/shock-section.tsx');
 assert.match(section,/lines=\[\.\.\.readingParts\(a\.market,locale\)/);assert.match(section,/<ShockStars article=\{a\} locale=\{locale\}\/>/);
 assert.ok(!/homeReadingParts|storyChange/.test(section+read('lib/resolute/risk.ts')+read('app/resolute/home/today-card.tsx')));
});

test('リゼルの一言 on the home: title only, only when one is assigned, behind the published flag; owners always see it',()=>{
 const section=read('app/resolute/home/shock-section.tsx');
 assert.ok(section.includes("{locale==='en'?'A word from RIZEL':'リゼルの一言'}"));
 assert.match(section,/feed\.quotes\.find\(q=>q\.id===article\.quoteId&&q\.approved\)/);
 assert.match(section,/if\(!quote\)return null;/);
 assert.match(section,/<p>\{quote\[locale\]\.title\}<\/p><\/div><\/div>/,'the phone shows the title only');
 assert.ok(read('app/resolute/news/screen.tsx').includes("{en?'A word from RIZEL':'リゼルの一言'}"));
 assert.ok(!read('app/resolute/news/screen.tsx').includes("'RIZELの一言'"));
 const feed={state:'ready',date:'2026-11-24',articles:[],quotes:[{id:'q'}]};
 for(const owner of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID])assert.equal(withRizelLine(feed,owner,{}),feed);
 assert.deepEqual(withRizelLine(feed,'user_member',{}),{...feed,quotes:[]});
});

test('the home chart line: about three months of the stored basket levels, validated on read',()=>{
 const levels=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10),close:100+i+0.123}));
 const session=levels[70].date,trail=basketTrail(levels,session);
 assert.equal(trail.length,TRAIL_SESSIONS);assert.equal(trail.at(-1).date,session);assert.equal(trail.at(-1).close,170.12);
 assert.deepEqual(safeTrail({nas100:trail,sox:null},session),{nas100:trail,sox:null});
 assert.equal(safeTrail({nas100:trail.slice(0,-1),sox:null},session),undefined,'must end on the snapshot session');
 assert.equal(safeTrail({nas100:[...trail].reverse(),sox:null},session),undefined);
 assert.equal(safeTrail({nas100:[{date:session,close:-1},{date:session,close:1}]},session),undefined);
 const snap=safeThermometerSnapshot({asOf:session,nas100:{status:'unavailable',reason:'stale-data'},sox:{status:'unavailable',reason:'stale-data'},vix:{status:'unavailable',reason:'stale-data'},trail:{nas100:trail,sox:null}},session);
 assert.deepEqual(snap.trail,{nas100:trail,sox:null});
});

test('phone home: chart card on top (the gauge card is gone, its note stays small), TODAY, Shock Gauge, picture tiles, one ALERTS panel',()=>{
 const home=read('app/resolute/home/screen.tsx'),chart=read('app/resolute/home/market-chart-card.tsx'),tiles=read('app/resolute/home/rules-alerts.tsx'),css=read('app/resolute/home/reference.module.css');
 assert.ok(!home.includes('MarketGaugeCard'));assert.match(chart,/\{THERMOMETER_NOTE\[locale\]\}/);
 assert.match(css,/\.chartLine \{[^}]*animation:draw 1s/);assert.match(css,/\.chartDot \{[^}]*pulse 2\.4s/);
 assert.ok(home.indexOf('<MarketChartCard')<home.indexOf('TODAY</div>{today}{shock}'));
 assert.match(tiles,/role="switch"/);assert.match(tiles,/className=\{s\.alerts\}/);
 for(const p of ['picBook','picPhone','picChart','picCoin'])assert.ok(tiles.includes(`s.${p}`),p);
 assert.match(home,/morningEnabled:on\},baseRevision:settings\.revision/);
});

test('PC home: 今日やること beside the needle meter, cards in a subgrid, the inline detail, the menu goes to the section',()=>{
 const home=read('app/resolute/home/screen.tsx'),section=read('app/resolute/home/shock-section.tsx'),css=read('app/resolute/home/reference.module.css'),shell=read('app/resolute/tool-shell.tsx');
 assert.match(home,/<ToolShell home pc identityReady/);
 assert.match(home,/<div className=\{`\$\{s\.pcTop\}[^>]*>\{today\}<NeedleCard/);
 assert.match(css,/\.pcTop \{[^}]*align-items:stretch/);
 assert.match(css,/\.shockGrid \{[^}]*repeat\(3,minmax\(0,1fr\)\)/);assert.match(css,/\.shockCard \{[^}]*grid-template-rows:subgrid/);
 assert.ok(section.includes("{isOpen?(en?'Close ▴':'閉じる ▴'):(en?'Details ▾':'くわしく ▾')}"));
 for(const k of ["'出どころ'","'日付'","'内容'"])assert.ok(section.includes(k),k);
 assert.match(section,/<FirstLineMeter view=\{firstLine\}/);assert.match(section,/quote\[locale\]\.reasons/);
 assert.match(css,/\.shockCard\[data-open\] \{[^}]*rgba\(255,90,100/);
 assert.ok(shell.includes('href==="/resolute/news"?"/resolute#shock-gauge":href'));
 assert.ok(shell.includes('{en?"Language and time zone":"言語とタイムゾーン"}</span>')&&shell.includes('{en?"Tech Phase":"Tech Phaseへ"}</span>'));
 assert.match(read('app/resolute/news/screen.tsx'),/if\(desktop&&!review\)router\.replace\('\/resolute#shock-gauge'\)/);
 assert.match(css,/\.root, \.root \* \{ word-break:auto-phrase;/);
 assert.ok(!/…/.test(section+read('app/resolute/home/today-card.tsx')),'no "…" truncation');
});

test('今日やること reads the AI plan route first and falls back to fixedTodayPlan',async()=>{
 const {parseTodayPlanResponse}=await import('../lib/resolute/today-plan.ts');
 const ai={date:'2026-11-24',source:'ai',direction:'up',headline:{ja:'浮かれて買い足さない',en:'Don’t chase the rally'},body:{ja:'一行目。\n二行目。',en:'One.\nTwo.'},
  checks:[{label:{ja:'買い増しライン −10%',en:'Buy-more line −10%'},rule:{ja:'どの銘柄も届いていません',en:'No stock has reached it'},today:{ja:'—',en:'—'},state:'ok'}],estimate:null};
 assert.deepEqual(parseTodayPlanResponse({plan:ai}),ai);
 assert.equal(parseTodayPlanResponse({plan:null}),null);
 assert.equal(parseTodayPlanResponse({error:'TODAY_PLAN_UNAVAILABLE'}),null);
 for(const bad of [{...ai,headline:{ja:'これは十三文字以上ある見出しです',en:'x'}},{...ai,body:{ja:'一行だけ',en:'x'}},{...ai,body:{ja:'一。\n二…',en:'a\nb'}},{...ai,checks:[...ai.checks,...ai.checks,...ai.checks,...ai.checks]},{...ai,direction:'sideways'}])
  assert.equal(parseTodayPlanResponse({plan:bad}),null);
 const card=read('app/resolute/home/today-card.tsx');
 assert.match(card,/fetch\('\/api\/resolute\/today-plan',\{cache:'no-store',credentials:'same-origin'/);
 assert.match(card,/plan=\{member\.ai\?\?fixedTodayPlan\(todayInput\(feed,snapshot,member\)\)\}/);
});
