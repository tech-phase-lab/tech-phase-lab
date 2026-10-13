import test from 'node:test';
import assert from 'node:assert/strict';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
import { networkFocus, layoutCompanyNetwork } from '../lib/research/company-network.ts';
const graph = companyNetworkFor({cik:1045810,ticker:'NVDA'});
test('normalizes shared companies and directed relationships with sources', () => {
  assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);
  assert.equal(new Set(graph.edges.map(e=>e.id)).size,graph.edges.length);
  for (const [from,to] of [['ASML','TSM'],['AMAT','TSM'],['TSM','NVDA'],['MU','NVDA'],['NVDA','DELL'],['DELL','CRWV']]) {
    const edge=graph.edges.find(e=>e.from===from&&e.to===to&&e.kind==='supply');
    assert.ok(edge,`${from} → ${to}`);
    assert.ok(edge.evidence.every(e=>e.sources.length&&e.sources.every(s=>s.url.startsWith('https://'))));
  }
  assert.equal(graph.nodes.some(n=>n.id==='COST'),false);
  assert.equal(companyNetworkFor({cik:1,ticker:'NVDA'}),null);
  assert.equal(companyNetworkFor({cik:1652044,ticker:'GOOGL'}).root,companyNetworkFor({cik:1652044,ticker:'GOOG'}).root);
});
test('two steps adds suppliers of suppliers without inventing direct edges', () => {
  const one=networkFocus(graph,'NVDA','direct'), two=networkFocus(graph,'NVDA','two');
  assert.equal(one.distances.get('TSM'),1);
  assert.equal(one.distances.has('ASML'),false);
  assert.equal(two.distances.get('ASML'),2);
  assert.ok(two.visibleEdges.some(e=>e.from==='ASML'&&e.to==='TSM'));
  assert.ok(!two.visibleEdges.some(e=>e.from==='ASML'&&e.to==='NVDA'));
});
test('competition cannot become a bridge to an unrelated supply chain', () => {
  const fake={root:'A',nodes:[],edges:[{id:'ab',from:'A',to:'B',kind:'competition'},{id:'bc',from:'B',to:'C',kind:'supply'}]};
  const focus=networkFocus(fake,'A','two');
  assert.ok(focus.competitors.has('B'));
  assert.equal(focus.distances.has('C'),false);
  assert.deepEqual(focus.visibleEdges.map(e=>e.id),['ab']);
});
test('stable layered layout fits narrow screens without overlapping nodes', () => {
  for(const width of [220,280,320,375,640,1100]) {
    const layout=layoutCompanyNetwork(graph.nodes,width), positions=Object.values(layout.positions);
    for(const p of positions) {
      assert.ok(p.x>=0&&p.x+p.width<=width&&p.y+p.height<=layout.height);
      assert.ok(p.width>=44&&p.height>=44);
    }
    for(let i=0;i<positions.length;i++) for(let j=i+1;j<positions.length;j++) {
      const a=positions[i],b=positions[j];
      assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
    networkFocus(graph,'TSM','two');
    assert.deepEqual(layoutCompanyNetwork(graph.nodes,width),layout);
  }
});
