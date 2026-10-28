import test from 'node:test';
import assert from 'node:assert/strict';
import { companyIntroductions } from '../lib/research/company-introductions.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';

test('Amazon equity flows to its investees separately from cloud customer and development roles', () => {
  const entry = companyIntroductions.find(c => c.tickers.includes('AMZN'));
  const graph = companyNetworkFor({ ticker: 'AMZN', cik: entry.cik });
  for (const id of ['OpenAI', 'Anthropic']) {
    const capital = graph.edges.find(e => e.kind === 'investment' && e.from === 'AMZN' && e.to === id);
    assert.ok(capital, `Amazon invests into ${id}`);
    assert.ok(capital.evidence.some(e => e.about === 'AMZN' && e.sources.some(s => s.url.endsWith('/amzn-20260630.htm'))));
    assert.ok(!graph.edges.some(e => e.kind === 'investment' && e.from === id && e.to === 'AMZN'));
    assert.ok(graph.edges.some(e => e.kind === 'supply' && e.from === 'AMZN' && e.to === id));
  }
  assert.ok(graph.edges.some(e => e.kind === 'partner' && [e.from, e.to].includes('OpenAI') && [e.from, e.to].includes('AMZN')));
  assert.match(entry.en.relationships, /28\.7bn/);
  assert.match(entry.en.relationships, /21\.3bn funded afterward/);
});

test('existing incoming investor direction remains unchanged', () => {
  const entry = companyIntroductions.find(c => c.tickers.includes('CAMT'));
  const graph = companyNetworkFor({ ticker: 'CAMT', cik: entry.cik });
  assert.ok(graph.edges.some(e => e.kind === 'investment' && e.from === 'Chroma ATE' && e.to === 'CAMT'));
  assert.ok(!graph.edges.some(e => e.kind === 'investment' && e.from === 'CAMT' && e.to === 'Chroma ATE'));
});
