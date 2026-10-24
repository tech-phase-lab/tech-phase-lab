import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertPriceAlert, formatAlertPrice } from '../lib/research/price-alert-settings.ts';
import { parseFavoriteLists } from '../lib/research/favorite-lists.ts';
const alert = { ticker:'AAPL', price:0.000001, direction:'above', currency:'USD' };

test('alert thresholds display their actual precision without changing quote formatting',()=>{
 assert.equal(formatAlertPrice(0.000001,'ja-JP'),'0.000001');
 assert.equal(formatAlertPrice(123.456789,'en-US'),'123.456789');
 assert.equal(formatAlertPrice(1000000000,'ja-JP'),'1,000,000,000');
});
test('editing one threshold retains the opposite condition and unrelated settings',()=>{
 const below={...alert,direction:'below',price:0.0000001};const other={...alert,ticker:'MU'};
 const original=[alert,below,other];const result=upsertPriceAlert(original,{...alert,price:250});
 assert.equal(result.ok,true);assert.deepEqual(result.alerts,[{...alert,price:250},below,other]);assert.equal(original[0].price,0.000001);
});
test('full settings reject new entries but permit updating an existing threshold',()=>{
 const full=Array.from({length:100},(_,i)=>({...alert,ticker:`T${i}`}));
 assert.deepEqual(upsertPriceAlert(full,alert),{ok:false,error:'limit'});
 const edited=upsertPriceAlert(full,{...full[0],price:300});assert.equal(edited.ok,true);assert.equal(edited.alerts.length,100);assert.equal(edited.alerts[0].price,300);
 assert.equal(upsertPriceAlert(full.slice(1),alert).alerts.length,100);
});
test('invalid settings are rejected without replacing saved values',()=>{
 for(const price of [0,-1,NaN,Infinity,1000000001]) assert.deepEqual(upsertPriceAlert([alert],{...alert,price}),{ok:false,error:'invalid'});
 for(const change of [{ticker:''},{currency:''},{direction:'sideways'}]) assert.equal(upsertPriceAlert([alert],{...alert,...change}).ok,false);
});
test('multiple lists and both alert conditions survive guest storage round-trip',()=>{
 const state={lists:[{id:'default',name:'長期',tickers:['AAPL','MU']},{id:'second',name:'短期',tickers:['MU','AAPL']}],names:{},alerts:[alert,{...alert,direction:'below',price:0.0000001}]};
 const restored=parseFavoriteLists(JSON.stringify(state),JSON.stringify(state.lists[0].tickers));assert.deepEqual(restored,state);
});
