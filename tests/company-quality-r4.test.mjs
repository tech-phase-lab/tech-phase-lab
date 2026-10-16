import test from 'node:test';
import assert from 'node:assert/strict';
import {companyIntroductions} from '../lib/research/company-introductions.ts';
import {companyNetworkFor} from '../lib/research/company-network.server.ts';
import {isStockMapCompany} from '../lib/research/company-network.ts';
const issuer=t=>companyIntroductions.find(c=>c.tickers[0]===t);
const graph=t=>companyNetworkFor({ticker:t,cik:issuer(t).cik});
test('diversified comparisons name actual products and distinguish editorial matches from issuer disclosures',()=>{
 for(const [t,peers] of [['MSFT',['AMZN','GOOG','AAPL','CRM']],['ADBE',['AAPL','MSFT','CRM']],['CRM',['MSFT','ORCL','SAP','HUBS','ADBE']]]){
  for(const id of peers){const e=issuer(t).maps.competition.find(x=>x.ticker===id);assert.ok(e,`${t}:${id}`);assert.match(e.label.en,/editorial/i);assert.ok(e.sourceIndexes.length>=2);}
 }
 assert.match(issuer('MSFT').maps.competition.find(x=>x.ticker==='AAPL').label.en,/operating systems/);
 assert.match(issuer('ADBE').maps.competition.find(x=>x.ticker==='MSFT').label.en,/Clipchamp.*Express/);
 assert.match(issuer('CRM').maps.competition.find(x=>x.ticker==='SAP').label.en,/Sales Cloud V2/);
 assert.ok(issuer('ADBE').maps.competition.some(x=>x.name==='Canva'));
 assert.equal(isStockMapCompany({id:'Canva',kind:'company'}),false);
});
test('robotics integration and historical automotive adoption do not become invented present procurement',()=>{
 const tx=issuer('TXN').maps.relationships.find(e=>e.ticker==='NVDA');assert.equal(tx.role,'partner');assert.match(tx.label.en,/March 2026.*Jetson Thor/);
 const ad=issuer('ADI').maps.relationships.find(e=>e.ticker==='GM');assert.equal(ad.role,'customer');assert.match(ad.label.en,/2020.*2022/);
 assert.ok(graph('ADI').edges.some(e=>e.kind==='supply' && e.from==='ADI' && e.to==='GM'));
 assert.ok(issuer('ADI').maps.relationships.some(e=>e.ticker==='TSM' && e.role==='supplier'));
});
test('listed battery supplier parents remain distinct from private subsidiaries and fake US tickers',()=>{
 const ts=issuer('TSLA');for(const id of ['Panasonic Holdings','CATL']){const e=ts.maps.relationships.find(x=>x.name===id);assert.ok(e && !e.ticker);assert.equal(e.role,'supplier');assert.ok(isStockMapCompany({id,kind:'company'}));assert.equal(graph('TSLA').nodes.find(n=>n.id===id).layer,2);}
 assert.equal(isStockMapCompany({id:'Panasonic Energy',kind:'company'}),false);
 assert.match(ts.en.relationships,/6752.*3750/);
});
test('strategic collaboration, early adoption and planned security integrations keep separate evidence',()=>{
 const d=graph('DDOG');assert.ok(d.edges.some(e=>e.kind==='competition' && [e.from,e.to].includes('AMZN')));assert.ok(d.edges.some(e=>e.kind==='partner' && [e.from,e.to].includes('AMZN')));
 const z=issuer('ZS');assert.match(z.maps.relationships.find(x=>x.ticker==='MSFT').label.en,/early-adoption/);assert.match(z.maps.relationships.find(x=>x.ticker==='CRWD').label.en,/plans/);assert.match(z.maps.relationships.find(x=>x.name==='OpenAI').label.en,/TAC/);
 for(const id of ['ADBE','SAP'])assert.ok(issuer('IBM').maps.relationships.some(x=>x.ticker===id && x.role==='partner'));
});
test('new named relationships do not import NVIDIA unrelated customers into selected issuer maps',()=>{
 for(const t of ['MSFT','ADBE','CRM','TXN','ADI','DDOG','ZS','TSLA','IBM']){
  const g=graph(t);assert.ok(g.nodes.length<=41 && g.edges.length<=61,t);assert.equal(new Set(g.nodes.map(n=>n.id)).size,g.nodes.length,t);
  for(const e of g.edges.filter(e=>!e.evidence.some(x=>x.about===t))){assert.equal(e.kind,'supply',t);assert.ok(issuer(t).maps.relationships.some(r=>r.role==='supplier' && (r.ticker??r.name)===e.to),t);}
 }
 assert.ok(!graph('TXN').nodes.some(n=>n.id==='NBIS'));
 assert.ok(!graph('ZS').nodes.some(n=>n.id==='SMCI'));
});
