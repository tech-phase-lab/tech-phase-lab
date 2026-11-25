import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firstDropPct,firstLineView,FIRST_LINE_PRICE_MAX_AGE_MS} from '../lib/resolute/first-line.ts';

const now=Date.parse('2026-11-25T15:00:00Z'),asOf='2026-11-25T14:55:00Z';
const lines=[{dropPct:20,amount:100},{dropPct:10,amount:100},{dropPct:30,amount:100}];

test('the first line is the shallowest purchase level of the saved plan',()=>{
 assert.equal(firstDropPct(lines),10);
 assert.equal(firstDropPct([]),null);
 assert.equal(firstDropPct(null),null);
 assert.equal(firstDropPct([{dropPct:0},{dropPct:100}]),null);
});

test('distance from the current price to the member\'s first line, as the closing-price alerts measure it',()=>{
 const v=firstLineView([{symbol:'NVDA',referencePrice:200}],lines,{NVDA:{price:190,asOf}},now);
 assert.equal(v.symbol,'NVDA');assert.equal(v.linePrice,180);assert.equal(v.dropPct,10);
 assert.equal(v.awayPct,5.3); // (190−180)/190
 assert.equal(v.reached,false);
 assert.equal(v.progress,0.5); // half of the way from 200 down to 180
});

test('a stock at or past its line is reached and comes first; otherwise the nearest stock is shown',()=>{
 const items=[{symbol:'AAA',referencePrice:100},{symbol:'BBB',referencePrice:100},{symbol:'CCC',referencePrice:100}];
 const near=firstLineView(items,lines,{AAA:{price:99,asOf},BBB:{price:92,asOf},CCC:{price:120,asOf}},now);
 assert.equal(near.symbol,'BBB');assert.equal(near.awayPct,2.2);assert.equal(near.progress,0.8);
 const past=firstLineView(items,lines,{AAA:{price:90,asOf},BBB:{price:85,asOf}},now);
 assert.equal(past.symbol,'BBB');assert.equal(past.reached,true);assert.equal(past.awayPct,0);assert.equal(past.progress,1);
 // Above the reference price the bar is empty, never negative.
 assert.equal(firstLineView([items[2]],lines,{CCC:{price:120,asOf}},now).progress,0);
});

test('nothing is invented: no plan line, no stock, no price or an old price gives no view',()=>{
 const item=[{symbol:'NVDA',referencePrice:200}];
 assert.equal(firstLineView(item,[],{NVDA:{price:190,asOf}},now),null);
 assert.equal(firstLineView([],lines,{NVDA:{price:190,asOf}},now),null);
 assert.equal(firstLineView(item,lines,{},now),null);
 assert.equal(firstLineView(item,lines,{NVDA:{price:0,asOf}},now),null);
 assert.equal(firstLineView(item,lines,{NVDA:{price:190,asOf:'nope'}},now),null);
 assert.equal(firstLineView(item,lines,{NVDA:{price:190,asOf:new Date(now-FIRST_LINE_PRICE_MAX_AGE_MS-1).toISOString()}},now),null);
});

test('the Shock Gauge never shows a "not connected" placeholder for the first line, and reads only the shared quote copy',()=>{
 const screen=readFileSync(new URL('../app/resolute/news/screen.tsx',import.meta.url),'utf8');
 const meter=readFileSync(new URL('../app/resolute/news/first-line-meter.tsx',import.meta.url),'utf8');
 for(const text of ['価格データ未接続','Price data not connected'])assert.ok(!screen.includes(text)&&!meter.includes(text),text);
 // Real members: the meter only when the view exists; the fictional numbers stay inside the labelled display sample.
 assert.match(screen,/firstLine\?<FirstLineMeter view=\{firstLine\} locale=\{locale\}\/>:null/);
 assert.match(screen,/useFirstLine\(!sample&&!locked&&!!article\)/);
 // No provider call from the page: the site's shared, allocator-governed quote copy only.
 assert.ok(meter.includes('/api/research/market/quotes?tickers='));
 assert.ok(!/twelvedata\.com|TWELVE_DATA_API_KEY/.test(meter));
});
