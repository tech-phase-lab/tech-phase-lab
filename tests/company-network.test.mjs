import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { companyIntroductions } from '../lib/research/company-introductions.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
import { networkFocus, layoutCompanyNetwork } from '../lib/research/company-network.ts';
const graph = companyNetworkFor({cik:1045810,ticker:'NVDA'});

test('NVIDIA exactly preserves the reviewed pre-expansion map payload', () => {
  // Independently captured from 95b5b29, before bulk issuer additions.
  // Includes ordering, labels, summaries, layers, evidence and sources.
  assert.equal(graph.nodes.length, 41);
  assert.equal(graph.edges.length, 61);
  assert.equal(createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
    '29f71db1aeb70e90a6b18f3837389c9c1ad5873a7255f3914862339b99a302a4');
  for (const symbol of ['BIDU','BABA','JD','TTWO','WMT','DOCN','WDAY','PATH']) {
    assert.ok(!graph.nodes.some(node => node.id === symbol));
  }
});

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

test('every issuer stays within its bounded map scale and does not traverse the live registry', () => {
  for (const item of companyIntroductions) {
    const map = companyNetworkFor({cik:item.cik,ticker:item.tickers[0]});
    // TSM now has 41 independently sourced counterparties plus its own card.
    // Keep every direct fact; this one-card allowance does not expand context.
    assert.ok(map.nodes.length <= (map.root === 'TSM' ? 43 : 41), `${map.root}: ${map.nodes.length} nodes`);
    assert.ok(map.edges.length <= 61, `${map.root}: ${map.edges.length} edges`);
  }
  const lite = companyNetworkFor({cik:1633978,ticker:'LITE'});
  for (const ticker of ['BIDU','BABA','JD','TTWO','WMT','DOCN','WDAY','PATH']) assert.ok(!lite.nodes.some(node=>node.id===ticker));
  const workday = companyNetworkFor({cik:1327811,ticker:'WDAY'});
  assert.ok(!workday.nodes.some(node=>node.id==='ASML'));
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


test('new issuer maps retain scoped competition and verified relationship direction', () => {
  for (const [cik,ticker,from,to] of [[1329394,'SIMO','SIMO','MU'],[1158114,'AAOI','AAOI','MSFT'],[1664703,'BE','BE','ORCL'],[1692819,'VST','VST','META'],[1878848,'IREN','DELL','IREN']]) {
    const network=companyNetworkFor({cik,ticker});
    assert.equal(network.root,ticker);
    assert.ok(network.edges.some(e=>e.kind==='supply'&&e.from===from&&e.to===to));
    assert.ok(networkFocus(network,ticker,'direct').competitors.size>0);
    assert.ok(network.nodes.filter(n=>n.kind==='industry').every(n=>n.id.startsWith(`${ticker}:industry:`)));
  }
  const intel=companyNetworkFor({cik:50863,ticker:'INTC'});
  assert.ok(intel.edges.some(e=>e.kind==='partner'&&e.from==='INTC'&&e.to==='NVDA'));
  assert.ok(intel.edges.some(e=>e.kind==='competition'&&e.from==='INTC'&&e.to==='NVDA'));
  const vistra=companyNetworkFor({cik:1692819,ticker:'VST'});
  assert.ok(vistra.edges.find(e=>e.from==='VST'&&e.to==='META').evidence.some(e=>e.label.en.includes('scheduled')));
});
