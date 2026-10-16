import test from 'node:test';
import assert from 'node:assert/strict';
import {companyIntroductions} from '../lib/research/company-introductions.ts';
import {companyNetworkFor} from '../lib/research/company-network.server.ts';
import {isStockMapCompany} from '../lib/research/company-network.ts';
const issuer=t=>companyIntroductions.find(c=>c.tickers[0]===t);
const graph=t=>companyNetworkFor({ticker:t,cik:issuer(t).cik});
test('cloud infrastructure and Marketplace distribution remain distinct roles on one counterparty card',()=>{
 const r=issuer('MANH').maps.relationships.filter(e=>e.ticker==='GOOG');assert.deepEqual(new Set(r.map(e=>e.role)),new Set(['supplier','ecosystem']));
 const g=graph('MANH');assert.equal(g.nodes.filter(n=>n.id==='GOOG').length,1);for(const kind of ['supply','partner'])assert.ok(g.edges.some(e=>e.kind===kind&&[e.from,e.to].includes('GOOG')));
 assert.match(issuer('ADSK').maps.relationships.find(e=>e.ticker==='AMZN').label.en,/plans/);
 assert.match(issuer('ADSK').maps.relationships.find(e=>e.ticker==='SNX').label.en,/14% distributor revenue/);
});
test('dated AI integration, eligible plans and payment acceptance do not become unsupported purchase claims',()=>{
 assert.match(issuer('TEAM').maps.relationships.find(e=>e.name==='Anthropic').label.en,/eligible plans/);
 assert.equal(issuer('BSY').maps.relationships.find(e=>e.ticker==='NVDA').role,'ecosystem');
 assert.match(issuer('COST').en.relationships,/not worldwide Visa-only/);
 const c=issuer('COST').maps.relationships.find(e=>e.ticker==='C');assert.ok(c&&c.sourceIndexes.some(i=>issuer('COST').sources[i].url.includes('/831001/')));assert.ok(isStockMapCompany(graph('COST').nodes.find(n=>n.id==='C')));
 assert.ok(!issuer('PAYC').maps.relationships.some(e=>e.ticker==='AMZN'));
 assert.ok(!issuer('DT').maps.relationships.some(e=>e.ticker==='NVDA'));
});
test('selected maps use product context and never expand through unrelated AI partner customers',()=>{
 for(const t of ['ADSK','PTC','BSY','VEEV','MANH','HUBS','TEAM','DT','OTEX','COST']){const g=graph(t);assert.ok(g.nodes.length<=41&&g.edges.length<=61,t);assert.equal(new Set(g.nodes.map(n=>n.id)).size,g.nodes.length,t);
  for(const e of g.edges.filter(e=>!e.evidence.some(x=>x.about===t))){assert.equal(e.kind,'supply',t);assert.ok(issuer(t).maps.relationships.some(r=>r.role==='supplier'&&(r.ticker??r.name)===e.to),t);}
 }
 assert.equal(graph('PTC').nodes.find(n=>n.id==='NVDA').layer,6);assert.equal(graph('DT').nodes.find(n=>n.id==='CSCO').layer,6);assert.equal(graph('COST').nodes.find(n=>n.id==='AMZN').layer,7);
 assert.ok(!graph('PTC').nodes.some(n=>n.id==='NBIS'));
});
