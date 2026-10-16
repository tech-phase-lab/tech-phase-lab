import test from 'node:test';
import assert from 'node:assert/strict';
import { companyIntroductions } from '../lib/research/company-introductions.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
import { isStockMapCompany, networkFocus } from '../lib/research/company-network.ts';

const issuer = ticker => companyIntroductions.find(c => c.tickers[0] === ticker);
const graph = ticker => companyNetworkFor({ticker,cik:issuer(ticker).cik});

test('AWS procurement, ad collaboration and two-way Marvell supply retain separate evidence and directions', () => {
  const p=graph('PINS');
  const infra=p.edges.find(e=>e.kind==='supply' && e.from==='AMZN' && e.to==='PINS');
  const ads=p.edges.find(e=>e.kind==='partner' && e.from==='AMZN' && e.to==='PINS');
  assert.ok(infra.evidence.some(e=>e.about==='PINS' && e.sources.some(s=>s.url.includes('pins-20251231'))));
  assert.ok(ads.evidence.some(e=>e.about==='PINS' && e.sources.some(s=>s.url.includes('third-party-ad-demand'))));
  const m=graph('MRVL');
  for(const [from,to] of [['MRVL','AMZN'],['AMZN','MRVL']]) assert.ok(m.edges.some(e=>e.kind==='supply' && e.from===from && e.to===to));
  assert.equal(m.nodes.filter(n=>n.id==='AMZN').length,1);
});

test('named platform dependencies and announced AI capacity do not become invented current delivery', () => {
  const snap=issuer('SNAP');
  assert.ok(snap.maps.relationships.some(e=>e.ticker==='GOOG' && e.role==='supplier'));
  assert.ok(snap.maps.relationships.some(e=>e.ticker==='GOOG' && e.role==='ecosystem'));
  assert.ok(snap.maps.relationships.some(e=>e.ticker==='AAPL' && e.role==='ecosystem'));
  assert.match(issuer('GOOG').maps.relationships.find(e=>e.name==='Anthropic').label.en,/2027/);
  assert.match(issuer('AMZN').maps.relationships.find(e=>e.name==='Anthropic').label.en,/up to.*staged/i);
  assert.match(issuer('META').maps.relationships.find(e=>e.ticker==='AMD').label.en,/plan.*scheduled/i);
  assert.match(issuer('ALAB').maps.relationships.find(e=>e.ticker==='AMZN').label.en,/warrants/i);
  assert.match(issuer('AAPL').maps.relationships.find(e=>e.name==='OpenAI').label.en,/2024/);
  assert.ok(!issuer('AMZN').maps.relationships.some(e=>e.name==='Anthropic' && e.role==='investor'));
});

test('audited platform maps stay about the selected company without importing an unrelated NVIDIA customer network', () => {
  for(const ticker of ['PINS','SNAP','AMAT','MRVL','VRT','ALAB','ON','AAPL','AMZN','GOOG','META']) {
    const g=graph(ticker);
    assert.ok(g.nodes.length<=41 && g.edges.length<=61,ticker);
    const own=g.edges.filter(e=>e.evidence.some(s=>s.about===ticker));
    for(const e of g.edges.filter(e=>!own.includes(e))) {
      assert.equal(e.kind,'supply',ticker);
      assert.ok(issuer(ticker).maps.relationships.some(r=>r.role==='supplier' && r.ticker===e.to),ticker);
    }
    for(const mode of ['direct','two','all']) {
      const f=networkFocus(g,ticker,mode);
      const eligible = new Set(g.nodes.filter(n=>n.id===ticker || isStockMapCompany(n)).map(n=>n.id));
      const displayed = f.visibleEdges.filter(e=>eligible.has(e.from) && eligible.has(e.to));
      assert.ok(displayed.length<=61,ticker);
    }
  }
  assert.ok(!graph('ALAB').nodes.some(n=>n.id==='NBIS'));
  assert.ok(!graph('META').nodes.some(n=>n.id==='SMCI'));
});
