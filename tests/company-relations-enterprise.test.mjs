import test from 'node:test';
import assert from 'node:assert/strict';
import { companyIntroductions } from '../lib/research/company-introductions.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
const issuer=t=>companyIntroductions.find(c=>c.tickers[0]===t);
const graph=t=>companyNetworkFor({ticker:t,cik:issuer(t).cik});
test('enterprise AI partnerships distinguish non-exclusive terms, capacity commitments and model integration',()=>{
 const m=issuer('MSFT');
 assert.match(m.maps.relationships.find(e=>e.name==='OpenAI').label.en,/April 2026.*non-exclusive/);
 assert.match(m.maps.relationships.find(e=>e.name==='Anthropic').label.en,/purchase commitment/);
 assert.match(issuer('ADBE').maps.relationships.find(e=>e.name==='OpenAI').label.en,/model integration/);
 assert.equal(issuer('ADBE').maps.relationships.find(e=>e.name==='OpenAI').role,'ecosystem');
 assert.match(issuer('BOX').maps.relationships.find(e=>e.name==='OpenAI').label.en,/permission-governed/i);
 assert.match(issuer('CRM').maps.relationships.find(e=>e.name==='Anthropic').label.en,/Claudeforce/);
});
test('hardware procurement and distribution keep named roles and product scopes',()=>{
 const d=graph('DELL');
 assert.ok(d.edges.some(e=>e.kind==='supply' && e.from==='NVDA' && e.to==='DELL'));
 assert.ok(d.edges.some(e=>e.kind==='supply' && e.from==='DELL' && e.to==='CRWV'));
 const h=graph('HPE');assert.ok(h.edges.some(e=>e.from==='AMD' && e.to==='HPE' && e.kind==='supply'));
 assert.match(h.nodes.find(n=>n.id==='AMD').businessLabel.en,/EPYC/);
 assert.match(issuer('ADSK').maps.relationships.find(e=>e.ticker==='SNX').label.en,/14% distributor revenue/);
 assert.match(issuer('WDAY').maps.relationships.find(e=>e.ticker==='GOOG').label.en,/Sana.*Gemini/);
});
test('onsemi keeps its existing named rivals and restores all three prose names with segment evidence',()=>{
 const o=issuer('ON');for(const id of ['TXN','ADI','MPWR','NXPI','Samsung','Infineon','STM','SONY']) assert.ok(o.maps.competition.some(e=>(e.ticker??e.name)===id),id);
 assert.ok(o.maps.relationships.some(e=>e.ticker==='NIO' && e.role==='customer'));
 const g=graph('ON');assert.equal(g.nodes.find(n=>n.id==='SONY').layer,3);assert.equal(g.nodes.find(n=>n.id==='SONY').businessLabel.en,'Image sensors');
});
test('enterprise maps limit extra context to the disclosed supplier upstream and keep each company card unique',()=>{
 for(const t of ['MSFT','ADBE','CRM','BOX','WDAY','DELL','HPE','ADSK','ON']){
  const g=graph(t);assert.equal(new Set(g.nodes.map(n=>n.id)).size,g.nodes.length,t);
  assert.ok(g.nodes.length<=41 && g.edges.length<=61,t);
  for(const e of g.edges.filter(e=>!e.evidence.some(x=>x.about===t))){assert.equal(e.kind,'supply',t);assert.ok(issuer(t).maps.relationships.some(r=>r.role==='supplier' && (r.ticker??r.name)===e.to),t);}
 }
 assert.ok(!graph('DELL').nodes.some(n=>n.id==='NBIS'));
 assert.ok(!graph('HPE').nodes.some(n=>n.id==='META'));
});
