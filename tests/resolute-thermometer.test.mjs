import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTemperature, calculateVixContext, percentile, temperatureBand } from '../lib/resolute/thermometer.ts';
import { collectThermometer, parseIndexHistory } from '../lib/resolute/thermometer-provider.ts';
function series() {
 const bars=[];
 for(let time=Date.parse('2013-01-01');time<=Date.parse('2026-10-23');time+=86400000){
  const day=new Date(time);if([0,6].includes(day.getUTCDay()))continue;
  bars.push({date:day.toISOString().slice(0,10),close:100});
 }
 return bars;
}
const asOf='2026-10-23';
const instrument={symbol:'SYNTHETIC',exchange:'TEST'};
const payload=(bars=series(),meta={})=>({status:'ok',meta:{...instrument,type:'Index',interval:'1day',...meta},values:bars.map(b=>({datetime:b.date,close:String(b.close)}))});
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
test('parser refuses ETF, wrong symbol/exchange/interval, and invalid numbers instead of substituting them',()=>{
 assert.equal(parseIndexHistory(payload(),instrument).length,series().length);
 for(const meta of [{type:'ETF'},{type:'CFD'},{symbol:'OTHER'},{exchange:'OTHER'},{interval:'1min'}])assert.equal(parseIndexHistory(payload(undefined,meta),instrument),null);
 for(const close of ['',null,true,'0','NaN','Infinity']){const p=payload();p.values[0].close=close;assert.equal(parseIndexHistory(p,instrument),null);}
});
test('disabled collector makes zero calls; independent failures and credentials never appear in output',async()=>{
 let calls=0;const config={enabled:false,apiKey:'synthetic-secret',instruments:{nas100:instrument,sox:{symbol:'BAD',exchange:'TEST'},vix:instrument}};
 const fetcher=async(url,options)=>{calls++;assert.equal(url.origin,'https://api.twelvedata.com');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('end_date'),asOf);return Response.json(url.searchParams.get('symbol')==='BAD'?{status:'error',message:'synthetic-secret'}:payload());};
 assert.equal((await collectThermometer(config,asOf,fetcher)).nas100.reason,'not-configured');assert.equal(calls,0);
 const result=await collectThermometer({...config,enabled:true},asOf,fetcher);
 assert.equal(calls,3);assert.equal(result.nas100.status,'ready');assert.equal(result.sox.reason,'invalid-data');assert.equal(result.vix.status,'ready');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));assert.equal(result.nas100.values,undefined);
 const failed=await collectThermometer({...config,enabled:true},asOf,async()=>{throw new Error('synthetic-secret');});
 assert.equal(failed.nas100.reason,'provider-error');assert.ok(!JSON.stringify(failed).includes('synthetic-secret'));
});
