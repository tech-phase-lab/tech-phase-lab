import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {companyIntroductions,companyIntroductionFor} from '../lib/research/company-introductions.ts';
import {companyNetworkFor} from '../lib/research/company-network.server.ts';
import {isStockMapCompany,networkFocus,layoutCompanyNetwork} from '../lib/research/company-network.ts';

const targets='AAOI AAPL ADBE ALAB AMAT AMD AMZN ANET APH ARM ASML AVGO BE CEG COHR CRDO CRM CRWD CRWV DELL GEV GOOG IBM INTC IONQ IREN KLAC LITE LRCX META MRVL MSFT MU NBIS NFLX NOW NVDA ORCL PANW PLTR QCOM SKHY SNDK SNOW SOFI STX TSLA TSM VRT VST'.split(' ');
const issuer=t=>companyIntroductions.find(c=>c.tickers.includes(t));
const graph=t=>companyNetworkFor({ticker:t,cik:issuer(t).cik});
const relation=(t,id,role)=>issuer(t).maps.relationships.find(e=>(e.ticker||e.name)===id&&e.role===role);

test('all 50 priority issuers have distinct valid identities, bilingual answers and named competition',()=>{
 assert.equal(targets.length,50);
 assert.equal(new Set(targets.map(t=>issuer(t)?.cik)).size,50);
 for(const t of targets){
  const c=issuer(t);assert.ok(c,t);assert.ok(c.maps.competition.some(e=>e.kind==='company'),t);
  assert.equal(Object.keys(c.ja).length,6,t);assert.equal(Object.keys(c.en).length,6,t);
  for(const rows of Object.values(c.maps))for(const e of rows){
   assert.ok(e.sourceIndexes.length,t);for(const i of e.sourceIndexes)assert.ok(c.sources[i]?.url.startsWith('https://'),t);
  }
 }
 assert.equal(companyIntroductionFor({ticker:'SNDK',cik:2023554}).name,'Sandisk');
 assert.equal(companyIntroductionFor({ticker:'SKHY',cik:2120882}).name,'SK hynix');
 assert.equal(companyIntroductionFor({ticker:'CEG',cik:1868275}).name,'Constellation Energy');
 assert.equal(companyIntroductionFor({ticker:'CEG',cik:1168165}),null);
});

test('Micron and memory peers separate NAND competition, qualification, deliveries and roadmap work',()=>{
 const mu=issuer('MU');assert.match(mu.en.business,/DRAM.*HBM/);
 for(const id of ['SNDK','Kioxia']){
  const e=mu.maps.competition.find(e=>(e.ticker||e.name)===id);assert.ok(e,id);assert.match(e.label.en,/NAND/);
  assert.match(graph('MU').nodes.find(n=>n.id===id).businessLabel.en,/only/);
 }
 assert.ok(relation('MU','AMD','customer'));assert.ok(relation('MU','AMD','partner'));
 assert.ok(relation('AMD','MU','supplier'));assert.ok(relation('AMD','MU','partner'));
 assert.ok(relation('QCOM','MU','partner'));assert.equal(Boolean(relation('QCOM','MU','customer')),false);
 assert.ok(relation('LRCX','MU','customer'));assert.ok(relation('LRCX','MU','partner'));
 assert.ok(relation('SKHY','AMAT','partner'));assert.ok(relation('TSM','SKHY','partner'));
 assert.match(relation('MU','QCOM','partner').label.en,/qualif|integrat/i);
 assert.equal(Boolean(relation('MU','QCOM','customer')),false);
 assert.match(relation('MU','NVDA','partner').label.en,/planned.*adoption/);
 assert.ok(relation('SKHY','SK square','investor'));
 const sk=graph('SKHY'),nv=sk.edges.find(e=>e.kind==='partner'&&[e.from,e.to].includes('NVDA'));
 const combined=nv.evidence.find(e=>e.about==='SKHY');
 assert.match(combined.label.en,/co-development/);assert.match(combined.label.en,/PhysicsNeMo/);
 assert.equal(relation('SKHY','NVDA','partner').label.en.includes('PhysicsNeMo'),false,'graph aggregation must not mutate the original role label');
 assert.match(relation('SKHY','SK square','investor').label.en,/March 31, 2026/);
 assert.ok(relation('SNDK','Kioxia','supplier'));assert.ok(relation('SNDK','Kioxia','partner'));
 assert.equal(Boolean(relation('SNDK','WDC','investor')),false);
});

test('commercial relationships retain separate directions and the correct investing entity',()=>{
 for(const t of ['IREN']){
  const g=graph(t);assert.ok(g.edges.some(e=>e.kind==='supply'&&e.from==='NVDA'&&e.to===t));
  assert.ok(g.edges.some(e=>e.kind==='supply'&&e.from===t&&e.to==='NVDA'));
 }
 assert.ok(relation('NBIS','NVDA','investor'));assert.ok(relation('NBIS','NVDA','supplier'));
 assert.ok(relation('CRWV','NVDA','investor'));assert.ok(relation('MRVL','NVDA','investor'));
 assert.ok(relation('BE','BAM','partner'));assert.equal(Boolean(relation('BE','BN','partner')),false);
 for(const t of ['ALAB','CRDO','QCOM'])for(const id of ['TSM','AMKR','ASX'])assert.ok(relation(t,id,'supplier'),`${t}:${id}`);
 const q=graph('QCOM');assert.equal(q.nodes.filter(n=>/Samsung/.test(n.name)).length,1);
 assert.ok(relation('QCOM','Samsung Electronics','customer'));
 assert.ok(relation('QCOM','Samsung Electronics','supplier'));
 for(const [t,id,layer] of [['AMD','Samsung Electronics',1],['AMAT','SKHY',2],['ASML','Samsung Electronics',2],['VRT','OKLO',5]]){
  assert.equal(graph(t).nodes.find(n=>n.id===id).layer,layer,`${t}:${id} product/role placement`);
 }
 assert.equal(graph('ARM').nodes.find(n=>n.id==='SoftBank').layer,7);
 assert.equal(graph('INTC').nodes.find(n=>n.id==='SoftBank Group').layer,7);
 assert.match(graph('COHR').layerLabels[1].en,/Investors.*SiC subsidiary/);
 assert.ok(issuer('DELL').maps.competition.some(e=>e.ticker==='P'));
 assert.ok(issuer('DELL').maps.competition.some(e=>e.ticker==='NTAP'));
});

test('priority maps keep every eligible direct peer and do not borrow unrelated NVIDIA customers',()=>{
 for(const t of targets.filter(t=>!['NVDA','NBIS'].includes(t))){
  const c=issuer(t),g=graph(t);
  for(const e of [...c.maps.competition,...c.maps.relationships].filter(e=>e.kind==='company')){
   const id=e.ticker||e.name;
   if(isStockMapCompany({id,ticker:e.ticker,kind:'company'}))assert.ok(g.nodes.some(n=>n.id===id),`${t} drops direct ${id}`);
  }
  assert.ok(g.edges.every(e=>e.evidence.some(ev=>ev.about===t)),t);
 }
 const tsm=graph('TSM');assert.equal(tsm.nodes.length,43);assert.equal(tsm.edges.length,48);
 for(const id of ['MRVL','CRDO','ALAB'])assert.ok(tsm.edges.some(e=>e.kind==='supply'&&e.from==='TSM'&&e.to===id));
 const n=graph('NVDA');assert.equal(createHash('sha256').update(JSON.stringify(n)).digest('hex'),'29f71db1aeb70e90a6b18f3837389c9c1ad5873a7255f3914862339b99a302a4');
});

test('all priority maps have non-overlapping bounded card geometry at both requested widths in every mode',()=>{
 for(const t of targets)for(const mode of ['direct','two','all'])for(const width of [375,1280]){
  const g=graph(t),f=networkFocus(g,g.root,mode);
  const nodes=g.nodes.filter(n=>(n.id===g.root||isStockMapCompany(n))&&(g.root==='NVDA'||mode==='all'||f.distances.has(n.id)||f.competitors.has(n.id)));
  const l=layoutCompanyNetwork(nodes,width),ps=Object.values(l.positions);
  for(const p of ps)assert.ok(p.x>=12&&p.x+p.width<=width-12&&p.y+p.height<=l.height,`${t}:${mode}:${width}`);
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
   const a=ps[i],b=ps[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${t}:${mode}:${width}`);
  }
 }
});
