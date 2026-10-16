import test from 'node:test';
import assert from 'node:assert/strict';
import { companyIntroductionFor } from '../lib/research/company-introductions.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';

const issuers = { ZM: 1585521, DOCN: 1582961, ESTC: 1707753, GTLB: 1653482, FROG: 1800667, NTNX: 1618732, NTAP: 1002047, BOX: 1372612, WDAY: 1327811, PATH: 1734722 };
test('cloud batch retains exact issuer identity and a fixed map root', () => {
  for (const [ticker, cik] of Object.entries(issuers)) {
    const record = companyIntroductionFor({ ticker, cik });
    assert.ok(record, ticker);
    // Completed product-scope or named-relationship re-reviews advance the date.
    assert.equal(record.reviewedOn, ['PATH', 'GTLB', 'NTAP', 'ZM', 'DOCN', 'ESTC', 'FROG', 'BOX', 'WDAY'].includes(ticker) ? '2026-10-16' : '2026-10-14');
    assert.equal(companyIntroductionFor({ ticker, cik: 1 }), null);
    const graph = companyNetworkFor({ ticker, cik });
    assert.equal(graph.root, ticker);
    assert.ok(graph.edges.some(edge => edge.kind === 'competition' && (edge.from === ticker || edge.to === ticker)));
    assert.ok(graph.edges.some(edge => edge.kind !== 'competition' && (edge.from === ticker || edge.to === ticker)));
  }
});

test('cloud adoption, integration and competition keep distinct directions', () => {
  const docn = companyNetworkFor({ ticker: 'DOCN', cik: issuers.DOCN });
  for (const supplier of ['NVDA', 'AMD']) {
    const edge = docn.edges.find(edge => edge.kind === 'supply' && edge.from === supplier && edge.to === 'DOCN');
    assert.ok(edge);
    assert.ok(edge.evidence.some(evidence => evidence.about === 'DOCN' && evidence.label.en.includes('not proof of direct procurement')));
  }
  const workday = companyNetworkFor({ ticker: 'WDAY', cik: issuers.WDAY });
  for (const kind of ['competition', 'partner']) {
    assert.ok(workday.edges.some(edge => edge.kind === kind && [edge.from, edge.to].includes('WDAY') && [edge.from, edge.to].includes('ADP')));
  }
  const path = companyNetworkFor({ ticker: 'PATH', cik: issuers.PATH });
  for (const partner of ['MSFT', 'SAP']) {
    assert.ok(path.edges.some(edge => edge.kind === 'partner' && [edge.from, edge.to].includes('PATH') && [edge.from, edge.to].includes(partner)));
    assert.ok(!path.edges.some(edge => edge.kind === 'supply' && [edge.from, edge.to].includes('PATH') && [edge.from, edge.to].includes(partner)));
  }
});
