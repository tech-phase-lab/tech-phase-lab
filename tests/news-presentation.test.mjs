import assert from 'node:assert/strict';
import test from 'node:test';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';
import { publicNewsPayload } from '../lib/research/general-news.ts';
const item={id:'1176',title:'Nonfarm payrolls +29K',translationJa:'非農業部門雇用者数 +29K',tickers:['ECON'],publisher:'Wall St Engine',url:'https://x.com/wallstengine/status/123',observedAt:'2026-10-02T12:31:00Z',bodyJa:'非農業部門雇用者数：+29K\n失業率：4.2%',bodyEn:'Nonfarm payrolls: +29K\nUnemployment rate: 4.2%'};
test('news categories never use publishers and story text follows the selected language',()=>{
  const ja=officialNewsDisplay(item,'ja'),en=officialNewsDisplay(item,'en');
  assert.equal(ja.label,'経済指標');assert.equal(en.label,'Economic indicators');
  assert.equal(ja.body,item.bodyJa);assert.equal(en.body,item.bodyEn);
  for(const publisher of ['Wall St Engine','FABY','NVIDIA IR']) assert.ok(!ja.label.includes(publisher));
  assert.equal(officialNewsDisplay({...item,tickers:['NVDA']},'ja').label,'企業ニュース · NVDA');
});
test('approved bilingual body survives parsing while arbitrary source text stays private',()=>{
  const feed=publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...item,text:'PRIVATE SOURCE',purpose:'PRIVATE ANALYSIS'}]});
  assert.equal(feed.officialUpdates[0].bodyJa,item.bodyJa);
  assert.equal(feed.officialUpdates[0].bodyEn,item.bodyEn);
  assert.ok(!JSON.stringify(feed).includes('PRIVATE'));
  const invalid=publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...item,bodyEn:null}]});
  assert.equal(invalid.officialUpdates.length,1);
  assert.equal(invalid.officialUpdates[0].bodyJa,undefined);
});
