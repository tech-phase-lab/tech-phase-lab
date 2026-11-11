import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTemperature, calculateVixContext, percentile, temperatureBand } from '../lib/resolute/thermometer.ts';
import { collectThermometer, parseStockHistories } from '../lib/resolute/thermometer-provider.ts';
import { equalWeightLevels, realizedVolatility } from '../lib/resolute/thermometer-basket.ts';
function series() {
 const bars=[];
 for(let time=Date.parse('2013-01-01');time<=Date.parse('2026-10-23');time+=86400000){
  const day=new Date(time);if([0,6].includes(day.getUTCDay()))continue;
  bars.push({date:day.toISOString().slice(0,10),close:100});
 }
 return bars;
}
const asOf='2026-10-23';
const tickersOf=n=>Array.from({length:n},(_,k)=>'T'+k);
const stockPayload=(tickers,bars=series(),drop=[])=>Object.fromEntries(tickers.map(t=>[t,drop.includes(t)?{status:'error',code:404,message:'not found'}:{status:'ok',values:bars.map(b=>({datetime:b.date,close:String(b.close)}))}]));
test('flat history is neutral; current shocks move in the correct direction for both indices',()=>{
 const bars=series();const flat=calculateTemperature('nas100',bars,asOf);
 assert.equal(flat.status,'ready');assert.equal(flat.score,50);assert.equal(flat.band,2);
 assert.equal(flat.drawdownPercent,0);assert.equal(flat.deviationPercent,0);
 for(const index of ['nas100','sox'])for(const [close,band] of [[50,0],[200,4]]){
  const result=calculateTemperature(index,[...bars.slice(0,-1),{date:asOf,close}],asOf);
  assert.equal(result.band,band);assert.equal(result.index,index);
 }
});
test('moving average includes 200 closes and rolling high includes 252; metrics are independently checkable',()=>{
 const bars=series();bars.at(-252).close=200;bars.at(-253).close=1000;bars.at(-1).close=80;
 const result=calculateTemperature('sox',bars,asOf);
 assert.equal(result.status,'ready');assert.ok(Math.abs(result.drawdownPercent+60)<1e-9);
 assert.ok(Math.abs(result.deviationPercent-100*(80/99.9-1))<1e-9);
});
test('future/unconfirmed prices cannot affect the gauge; newest-first input is equivalent and unmutated',()=>{
 const bars=series();const expected=calculateTemperature('nas100',bars,asOf);
 assert.deepEqual(calculateTemperature('nas100',[...bars,{date:'2026-10-26',close:99999}],asOf),expected);
 const descending=bars.slice().reverse(),copy=structuredClone(descending);
 assert.deepEqual(calculateTemperature('nas100',descending,asOf),expected);assert.deepEqual(descending,copy);
});
test('stale, missing, malformed, duplicate, or short history never produces a reading',()=>{
 const bars=series();
 for(const bad of [[...bars,bars.at(-1)],[...bars,{date:'2026-02-30',close:2}],bars.map((b,i)=>i===20?{...b,close:NaN}:b),bars.filter((_,i)=>i<500||i>520)])assert.equal(calculateTemperature('sox',bad,asOf).reason,'invalid-data');
 assert.equal(calculateTemperature('sox',bars.slice(0,-1),asOf).reason,'stale-data');
 assert.equal(calculateTemperature('sox',bars.slice(-2600),asOf).reason,'insufficient-history');
 assert.equal(calculateTemperature('sox',[],asOf).reason,'insufficient-history');
});
test('percentile ties and five boundaries are defined; VIX is separate and rises with fear',()=>{
 assert.equal(percentile(2,[1,2,2,3]),50);
 assert.deepEqual([0,19.99,20,40,60,80,100].map(temperatureBand),[0,0,1,2,3,4,4]);
 assert.throws(()=>temperatureBand(NaN));assert.throws(()=>percentile(1,[]));
 const bars=series();bars.at(-1).close=150;const result=calculateVixContext(bars,asOf);
 assert.equal(result.percentile,100);assert.equal(result.level,150);assert.equal(result.band,undefined);
});
test('equal-weight basket averages returns, lets new listings join later, and skips missing tickers',()=>{
 const base=series().slice(-30);
 const a=base.map((b,i)=>({date:b.date,close:100*1.01**i})),flat=base.map(b=>({date:b.date,close:50}));
 const many={};for(let k=0;k<10;k++)many['A'+k]=a;many.FLAT=flat;
 const levels=equalWeightLevels(many);
 assert.equal(levels.length,30);assert.equal(levels[0].close,100);
 // ten stocks +1%, one 0%: average daily return = 10/11 %
 assert.ok(Math.abs(levels[1].close/levels[0].close-(1+0.1/11))<1e-12);
 // a stock listed later contributes only from its second day
 const late={...many,NEW:base.slice(10).map((b,i)=>({date:b.date,close:10*2**i}))};
 const withNew=equalWeightLevels(late);
 assert.ok(Math.abs(withNew[10].close/withNew[9].close-levels[10].close/levels[9].close)<1e-12);
 assert.ok(withNew[11].close/withNew[10].close>levels[11].close/levels[10].close);
 // too few tickers on a date means no basket point
 assert.equal(equalWeightLevels({A:a,B:a}).length,0);
});
test('realized volatility is 20-day annualised and rises with turbulence',()=>{
 const calm=Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),close:100}));
 assert.equal(realizedVolatility(calm).length,0);
 const alt=calm.map((b,i)=>({...b,close:100*(i%2?1.01:1)}));
 const vol=realizedVolatility(alt);assert.equal(vol.length,60-20);
 assert.ok(vol.at(-1).close>14&&vol.at(-1).close<18);
});
test('stock parser reports missing tickers instead of guessing',()=>{
 const parsed=parseStockHistories(stockPayload(['A','B','C'],series().slice(-5),['B']),['A','B','C','D']);
 assert.deepEqual(Object.keys(parsed.series),['A','C']);assert.deepEqual(parsed.missing,['B','D']);
 const single=parseStockHistories({status:'ok',values:[{datetime:'2026-10-23',close:'0'}]},['A']);
 assert.deepEqual(single.missing,['A']);
});
test('disabled collector makes zero calls; one failed ticker is logged and the run continues; credentials never appear',async()=>{
 let calls=0;const rosters={nasdaq100:tickersOf(12),semiconductors:tickersOf(11).map(t=>'S'+t)};
 const config={enabled:false,apiKey:'synthetic-secret',rosters};
 const fetcher=async(url,options)=>{calls++;assert.equal(url.origin,'https://api.twelvedata.com');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('end_date'),new Date(Date.parse(asOf+'T00:00:00Z')+864e5).toISOString().slice(0,10));
  const tickers=url.searchParams.get('symbol').split(',');return Response.json(stockPayload(tickers,series(),tickers.filter(t=>t==='T3')));};
 assert.equal((await collectThermometer(config,asOf,fetcher)).nas100.reason,'not-configured');assert.equal(calls,0);
 const result=await collectThermometer({...config,enabled:true},asOf,fetcher);
 assert.equal(calls,4);assert.equal(result.nas100.status,'ready');assert.equal(result.sox.status,'ready');assert.equal(result.vix.status,'unavailable'); // flat synthetic prices have zero volatility, which is never shown as a reading
 assert.deepEqual(result.missing,['T3']);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 const failed=await collectThermometer({...config,enabled:true},asOf,async()=>{throw new Error('synthetic-secret');});
 assert.equal(failed.nas100.reason,'provider-error');assert.equal(failed.sox.reason,'provider-error');assert.ok(!JSON.stringify(failed).includes('synthetic-secret'));
});
