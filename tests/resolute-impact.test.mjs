import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storyImpact,parseImpactHints,heldWeights,IMPACT_LABELS} from '../lib/resolute/impact.ts';
import {chainDataFor} from '../lib/research/chain-map-data.ts';

// あなたへの影響 (owner, Nov 26 spec §4), on the Nov 25 stories: a market-wide fall (★4) and Nvidia's (★4).
const nvdaChain=chainDataFor('NVDA');
const nvdaRelated=[...new Set([...nvdaChain.companies.map(c=>c.ticker),...nvdaChain.rivals])].filter(t=>t&&t!=='NVDA');
const market={tickers:[],related:[],sector:null,marketWide:true};
const nvda={tickers:['NVDA'],related:nvdaRelated,sector:'tech_semis',marketWide:false};
const members={
 holdings:{held:heldWeights([{ticker:'NVDA',shares:10,avgCostUsd:150},{ticker:'AAPL',shares:5,avgCostUsd:200}]),watch:['MSFT'],sector:'tech_semis'},
 watchOnly:{held:[],watch:['AMD','MSFT'],sector:null},
 nothing:{held:[],watch:[],sector:'tech_semis'},
};
test('three members on Nov 25: holdings, a watchlist only, and nothing',()=>{
 assert.ok(nvdaRelated.includes('AMD'),'AMD is tied to NVDA in the relationship data');
 const a=storyImpact(nvda,members.holdings);
 assert.equal(a.level,3);assert.deepEqual(a.logos,[{ticker:'NVDA',kind:'held'}]);assert.ok(a.position>75&&a.position<=95);
 assert.equal(storyImpact(market,members.holdings).level,1,'market-wide news: 中');
 const b=storyImpact(nvda,members.watchOnly);
 assert.equal(b.level,1,'a competitor or customer of a watchlist stock: 中');assert.deepEqual(b.logos,[{ticker:'AMD',kind:'watch'},{ticker:'MSFT',kind:'watch'}]);
 assert.equal(storyImpact(market,members.watchOnly).level,1);
 assert.equal(storyImpact({...nvda,tickers:['AMD']},members.watchOnly).level,2,'a watchlist stock itself: 大');
 for(const h of [nvda,market])assert.deepEqual(storyImpact(h,members.nothing),{level:null,position:null,logos:[]},'nothing held or watched: the empty state');
});
test('the levels and the needle follow the rules; no reasons are produced',()=>{
 const m={held:[{ticker:'TSM',weight:0.6}],watch:[],sector:null};
 assert.equal(storyImpact(nvda,m).level,nvdaRelated.includes('TSM')?2:0,'a supplier or competitor of a held stock: 大');
 assert.equal(storyImpact({tickers:['XOM'],related:[],sector:null,marketWide:false},{held:[],watch:['AAPL'],sector:null}).level,0,'anything else: 小');
 assert.equal(storyImpact({tickers:['XOM'],related:[],sector:'tech_semis',marketWide:false},{held:[],watch:['AAPL'],sector:'tech_semis'}).level,1,'the sector named in the diagnosis: 中');
 // Inside a level the needle moves right with more stocks and a larger weight, never into the next quarter.
 const small=storyImpact(nvda,{held:[{ticker:'NVDA',weight:0.05}],watch:[],sector:null}),big=storyImpact(nvda,{held:[{ticker:'NVDA',weight:0.9}],watch:[],sector:null});
 assert.ok(small.position<big.position&&big.position<=95&&small.position>75);
 // At most three logos.
 assert.equal(storyImpact({tickers:['A','B','C','D'],related:[],sector:null,marketWide:false},{held:[],watch:['A','B','C','D'],sector:null}).logos.length,3);
 assert.deepEqual(IMPACT_LABELS,{ja:['小','中','大','特大'],en:['Low','Medium','High','Very high']});
 assert.throws(()=>parseImpactHints({tickers:['nvda'],related:[],sector:null,marketWide:'yes'}));
 assert.deepEqual(parseImpactHints(nvda).tickers,['NVDA']);
});
test('the card: badge, impact, table, リゼル; empty state text and link; owner-only spec words present',()=>{
 const card=readFileSync(new URL('../app/resolute/features/shock-card.tsx',import.meta.url),'utf8');
 for(const s of ['あなたへの影響','Impact on you','ウォッチリストに銘柄を入れると、あなたへの影響が分かります','入れる →','/research/watchlist','保有','ウォッチリスト'])assert.ok(card.includes(s),s);
 assert.ok(!/[▼▲]/.test(card));
 const section=readFileSync(new URL('../app/resolute/home/shock-section.tsx',import.meta.url),'utf8');
 assert.ok(section.includes('ImpactGauge')&&section.includes('ShockTableView')&&section.includes('ShockBadge'));
 assert.ok(!section.includes('反応待ち'));
});
