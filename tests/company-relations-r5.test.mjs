import test from 'node:test';
import assert from 'node:assert/strict';
import {companyIntroductions} from '../lib/research/company-introductions.ts';
import {companyNetworkFor} from '../lib/research/company-network.server.ts';
const issuer=t=>companyIntroductions.find(c=>c.tickers[0]===t);
const graph=t=>companyNetworkFor({ticker:t,cik:issuer(t).cik});
const targets=['APH','CRWD','NET','ORCL','NOW','SNOW','INTU','SAP','ADP','PAYX','NTNX'];
test('research programs and pilots are distinct from disclosed compute-capacity purchase roles',()=>{
 assert.match(issuer('NET').maps.relationships.find(e=>e.name==='OpenAI').label.en,/research pilot/);
 assert.match(issuer('CRWD').maps.relationships.find(e=>e.name==='Anthropic').label.en,/Program/);
 const o=issuer('ORCL').maps.relationships.filter(e=>e.name==='OpenAI');assert.deepEqual(new Set(o.map(e=>e.role)),new Set(['customer','partner']));
 assert.ok(graph('ORCL').edges.some(e=>e.kind==='supply'&&e.from==='ORCL'&&e.to==='OpenAI'));
 assert.ok(graph('ORCL').edges.some(e=>e.kind==='partner'&&[e.from,e.to].includes('OpenAI')));
 assert.equal(graph('ORCL').nodes.filter(n=>n.id==='OpenAI').length,1);
});
test('availability claims and announced integration plans retain source-specific status',()=>{
 assert.match(issuer('SAP').maps.relationships.find(e=>e.name==='Anthropic').label.en,/planned/);
 assert.match(issuer('SNOW').maps.relationships.find(e=>e.name==='OpenAI').label.en,/generally available/);
 assert.match(issuer('NTNX').maps.relationships.find(e=>e.ticker==='NTAP').label.en,/planned availability/);
 assert.match(issuer('PAYX').maps.relationships.find(e=>e.ticker==='MSFT').label.en,/available/);
 assert.match(issuer('APH').en.relationships,/technical cooperation, not current procurement/);
 assert.ok(issuer('APH').maps.relationships.find(e=>e.ticker==='NVDA').sourceIndexes.length===2);
});
test('named collaborations keep selected-issuer maps bounded without importing partner customer networks',()=>{
 for(const t of targets){const c=issuer(t),g=graph(t);assert.ok(g.nodes.length<=41&&g.edges.length<=61,t);assert.equal(new Set(g.nodes.map(n=>n.id)).size,g.nodes.length,t);
  for(const e of g.edges.filter(e=>!e.evidence.some(x=>x.about===t))){assert.equal(e.kind,'supply',t);assert.ok(c.maps.relationships.some(r=>r.role==='supplier'&&(r.ticker??r.name)===e.to),t);}
 }
 for(const t of ['APH','NOW'])assert.ok(!graph(t).nodes.some(n=>n.id==='NBIS'),t);
 assert.equal(graph('APH').nodes.find(n=>n.id==='CSCO').layer,5);
 assert.equal(graph('ADP').nodes.find(n=>n.id==='WDAY').layer,7);
});
