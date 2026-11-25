// Owner, Nov 25 (resolute-pc-morning-thermo-1125 §1): the home 今日やること card. Never a down-day rule on an up day; the fixed
// sentences follow the shared contract (TODAY-CONTRACT) until the AI plan exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixedTodayPlan,todayDirection} from '../lib/resolute/today-plan.ts';
import {summaryIssues} from '../lib/resolute/risk-copy-check.ts';

const base={date:'2026-11-24',news:[],thermometer:null,lines:{buyDropPct:10,stopLossPct:30,surgeCapPct:50},stocks:[]};
const up5={stars:5,changePercent:14.7},down3={stars:3,changePercent:-4.5};

test('direction comes from the top-rated story\'s own index',()=>{
 assert.deepEqual(todayDirection([]),{stars:null,direction:'flat'});
 assert.deepEqual(todayDirection([{stars:3,changePercent:-2},up5]),{stars:5,direction:'up'});
 assert.deepEqual(todayDirection([{stars:null,changePercent:null},down3]),{stars:3,direction:'down'});
});

test('the fixed sentences, in the contract\'s order',()=>{
 assert.equal(fixedTodayPlan(base).headline.ja,'いつも通りでいい');
 assert.equal(fixedTodayPlan({...base,news:[{stars:2,changePercent:-1}]}).headline.ja,'いつも通りでいい');
 assert.equal(fixedTodayPlan({...base,news:[down3]}).headline.ja,'むやみに動かない');
 assert.equal(fixedTodayPlan({...base,news:[up5]}).headline.ja,'浮かれて買い足さない');
 assert.equal(fixedTodayPlan({...base,news:[up5],thermometer:{index:'sox',band:4,changePercent:14.7}}).headline.ja,'買いすぎに気をつける');
 assert.equal(fixedTodayPlan({...base,stocks:[{symbol:'MU',fromReferencePct:52}]}).headline.ja,'買いすぎに気をつける');
 assert.equal(fixedTodayPlan({...base,news:[up5],stocks:[{symbol:'NVDA',fromReferencePct:-12.3}]}).headline.ja,'決めていた買い増しの日');
 const exit=fixedTodayPlan({...base,news:[down3],stocks:[{symbol:'NVDA',fromReferencePct:-12.3}],estimate:{allowedDropPct:30,estimatedChangePct:-31,remainingPct:0}});
 assert.equal(exit.headline.ja,'決めたラインに届いた');assert.equal(exit.source,'fixed');
});

test('an up day never gets a down-day sentence, and the copy stays plain',()=>{
 for(const stars of [3,4,5]){
  const p=fixedTodayPlan({...base,news:[{stars,changePercent:6}]});
  assert.equal(p.direction,'up');assert.notEqual(p.headline.ja,'むやみに動かない');
  assert.doesNotMatch(p.body.ja,/手を止める|許容できる下落|損切り/);
 }
 for(const input of [base,{...base,news:[down3]},{...base,news:[up5]},{...base,lines:{buyDropPct:null,stopLossPct:null,surgeCapPct:null},news:[up5]}]){
  const p=fixedTodayPlan(input);
  assert.ok([...p.headline.ja].length<=12,p.headline.ja);
  const lines=p.body.ja.split('\n').length;assert.ok(lines>=2&&lines<=4,p.body.ja);
  assert.ok(!p.body.ja.includes('…')&&!p.body.en.includes('…'));
  assert.deepEqual(summaryIssues(p.headline,p.body),[]);
 }
});

test('checks: at most three, ✓ until a line is reached, numbers only from the input',()=>{
 const p=fixedTodayPlan({...base,news:[up5],thermometer:{index:'sox',band:4,changePercent:14.7},stocks:[{symbol:'MU',fromReferencePct:52},{symbol:'NVDA',fromReferencePct:-3}]});
 assert.equal(p.checks.length,3);
 assert.deepEqual(p.checks.map(c=>[c.label.ja,c.rule.ja,c.today.ja,c.state]),[
  ['相場の温度計　TP半導体40','熱い','+14.7%','reached'],
  ['上昇の目安 +50%','MUが届きました','+52%','reached'],
  ['買い増しライン −10%','どの銘柄も届いていません','—','ok'],
 ]);
 assert.deepEqual(fixedTodayPlan(base).checks,[],'no stocks and no gauge: no rows');
});

test('home: the 今日やること card replaces 「あなたのルール」; members without a plan keep 「ルールを決める」',()=>{
 const home=readFileSync(new URL('../app/resolute/home/screen.tsx',import.meta.url),'utf8');
 const card=readFileSync(new URL('../app/resolute/home/today-card.tsx',import.meta.url),'utf8');
 assert.ok(home.includes("<ShockGaugeTitle locale={locale} compact/>"));assert.ok(home.includes("{en?'Details →':'詳細 →'}"));
 assert.ok(!home.includes('あなたのルール')&&!home.includes('ルールを読み返す')&&!home.includes('shockRule'));
 assert.ok(home.includes('<TodayCard '));
 assert.ok(card.includes("<Link href=\"/resolute/diagnosis\">{en?'Set your rules →':'ルールを決める →'}</Link>"));
 assert.ok(card.includes("{en?'Open your rulebook →':'一冊を開く →'}")&&card.includes("{en?'A moment to breathe':'今夜のひと息'}"));
 assert.ok(card.includes('fixedTodayPlan('));
 const css=readFileSync(new URL('../app/resolute/home/reference.module.css',import.meta.url),'utf8');
 assert.match(css,/\.todayCard, \.todayCard \* \{ word-break:auto-phrase;/);
 assert.doesNotMatch(css.slice(css.indexOf('.todayCard')),/#ffb454/,'no orange text in the card');
});
