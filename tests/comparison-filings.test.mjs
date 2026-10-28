import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { financialFilings, inlineFinancialFacts, mergeFinancialFacts, tsmQuarterFacts, tsmStatementFacts } from '../lib/research/comparison-filings.ts';
import { loadSecComparison } from '../lib/research/comparison-loader.ts';
import { extractFinancials } from '../lib/research/comparison.ts';
const annualHtml = await readFile(new URL('./fixtures/tsm-2025-inline-excerpt.html',import.meta.url),'utf8');
const quarterHtml = await readFile(new URL('./fixtures/tsm-2026-q2-release-excerpt.html',import.meta.url),'utf8');
const statementHtml = await readFile(new URL('./fixtures/tsm-2026-q2-statements-excerpt.html',import.meta.url),'utf8');
const bloomHtml = await readFile(new URL('./fixtures/be-2025-income-excerpt.html',import.meta.url),'utf8');
const oldFacts = JSON.parse(await readFile(new URL('./fixtures/tsm-companyfacts-excerpt.json',import.meta.url),'utf8'));
const now = Date.parse('2026-10-03T13:00:00Z');
const annual = { accession:'0001628280-26-025362',form:'20-F',filed:'2026-04-16',end:'2025-12-31',url:'https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm',inline:true };
const quarter = { accession:'0001046179-26-000451',form:'6-K',filed:'2026-07-16',end:'2026-06-30',url:'https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/tsm-20260716x6k.htm',inline:false };
const submission = { cik:1046179,filings:{recent:{accessionNumber:[quarter.accession,annual.accession],form:[quarter.form,annual.form],filingDate:[quarter.filed,annual.filed],reportDate:[quarter.end,annual.end],primaryDocument:['tsm-20260716x6k.htm','tsm-20251231.htm'],isInlineXBRL:[0,1]}} };
const parse = p => extractFinancials('TSM','1046179',p,now,'TWD');
test('2025 TSM filing supplies new native-currency annual figures without convenience USD or segment data',()=>{
  const facts=inlineFinancialFacts(annualHtml,'1046179',annual),r=parse(facts);
  assert.equal(r.revenue.end,'2025-12-31');assert.equal(r.revenue.value,3809054300000);
  assert.equal(r.previousRevenue.value,2894307700000);assert.equal(r.operatingIncome.value,1936091700000);
  assert.equal(r.operatingCash.value,2274975600000);assert.equal(r.capex.value,1272410500000);
  assert.ok(Math.abs(r.revenueGrowth-31.605)<.001);assert.ok(Math.abs(r.operatingMargin-50.82867)<.00001);
  assert.equal(r.balance.cash.unit,'TWD');assert.equal(r.revenue.accession,annual.accession);
});
test('TSM release reads NT$ million actuals and same-quarter previous year, excludes guidance and USD',()=>{
  const p=tsmQuarterFacts(quarterHtml,'1046179',quarter),r=parse(mergeFinancialFacts(inlineFinancialFacts(annualHtml,'1046179',annual),[p],'1046179'));
  assert.equal(r.quarterRevenue.value,1270381000000);assert.equal(r.previousQuarterRevenue.value,933792000000);
  assert.equal(r.quarterRevenue.start,'2026-04-01');assert.equal(r.quarterRevenue.end,'2026-06-30');
  assert.ok(Math.abs(r.quarterRevenueGrowth-36.04539)<.00001);assert.ok(Math.abs(r.quarterOperatingMargin-60.34434)<.00001);
  assert.equal(r.quarterRevenue.accession,quarter.accession);
  // A release has no balance sheet; the annual snapshot keeps its own date.
  assert.equal(r.balance.end,'2025-12-31');assert.equal(r.balance.filed,annual.filed);
});
test('reject changed issuer, currency, period and inconsistent reported growth in untagged release',()=>{
  for(const [html,cik,f] of [[quarterHtml,'1',quarter],[quarterHtml.replace('NT$ million','US$ million'),'1046179',quarter],[quarterHtml,'1046179',{...quarter,end:'2026-09-30'}],[quarterHtml.replace('36.0','46.0'),'1046179',quarter]]) assert.equal(tsmQuarterFacts(html,cik,f),null);
});
test('original inline scale, negative sign and comma-decimal formats survive; segmented and foreign-issuer facts do not',()=>{
  const xml=(amount,attrs='',context='')=>`<html><xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>${context}</xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="us-gaap:OperatingIncomeLoss" unitRef="u" contextRef="c" ${attrs}>${amount}</ix:nonFraction></html>`;
  const fact=(html,cik='1')=>inlineFinancialFacts(html,cik,{...annual,form:'10-K'}).facts['us-gaap']?.OperatingIncomeLoss?.units.USD[0];
  assert.equal(fact(xml('1,234.5','scale="6" sign="-" format="ixt:num-dot-decimal"')).val,-1234500000);
  assert.equal(fact(xml('1.234,5','scale="3" format="ixt:num-comma-decimal"')).val,1234500);
  for(const html of [xml('1','format="ixt:unknown"'),xml('1','','<xbrli:segment><xbrldi:explicitMember>Member</xbrldi:explicitMember></xbrli:segment>'),xml('1','scale="99"'),xml('1','xsi:nil="true"')])assert.equal(fact(html),undefined);
  assert.equal(fact(xml('1'),'2'),undefined);
});
test('submission validation rejects foreign CIK, future reports and unsafe archive paths',()=>{
  assert.throws(()=>financialFilings(submission,'2',now),/cik/);
  assert.equal(financialFilings(submission,'1046179',now)[0].accession,quarter.accession);
  const bad=structuredClone(submission);bad.filings.recent.primaryDocument[0]='../foreign.htm';bad.filings.recent.filingDate[1]='2027-01-01';
  assert.deepEqual(financialFilings(bad,'1046179',now),[]);
});
function upstream(options={}) {
  return async url=>{
    if(options.fail?.(url))throw Error('unavailable');
    if(url.includes('/companyfacts/'))return JSON.stringify(oldFacts);
    if(url.includes('/submissions/'))return JSON.stringify(submission);
    if(url===annual.url)return annualHtml;
    if(url===quarter.url)return '<a href="a2q26e_withguidancexfinal.htm">EX-99.1</a>';
    if(url.endsWith('/a2q26e_withguidancexfinal.htm'))return quarterHtml;
    throw Error(url);
  };
}
test('stale companyfacts automatically fall back to latest annual and foreign quarter original documents',async()=>{
  const r=await loadSecComparison('TSM','1046179',upstream(),now);
  assert.equal(r.revenue.end,'2025-12-31');assert.equal(r.quarterRevenue.end,'2026-06-30');assert.deepEqual(r.dataWarnings,[]);
});
test('companyfacts outage still recovers from original filings',async()=>{
  const r=await loadSecComparison('TSM','1046179',upstream({fail:u=>u.includes('/companyfacts/')}),now);
  assert.equal(r.status,'ready');assert.equal(r.revenue.end,'2025-12-31');assert.equal(r.quarterRevenue.end,'2026-06-30');
});
test('upstream outage retains available figures and explicitly reports missing newer filing data',async()=>{
  let r=await loadSecComparison('TSM','1046179',upstream({fail:u=>u===annual.url}),now);
  assert.equal(r.revenue.end,'2024-12-31');assert.ok(r.dataWarnings.some(w=>w.en.includes('2025-12-31')));
  r=await loadSecComparison('TSM','1046179',upstream({fail:u=>u.includes('/submissions/')}),now);
  assert.equal(r.revenue.end,'2024-12-31');assert.match(r.dataWarnings[0].en,/could not be checked/);
});
test('6-K and 40-F tagged periods work for arbitrary issuers, without treating YTD as a standalone quarter',()=>{
  const p=inlineFinancialFacts(annualHtml,'1046179',{...annual,form:'40-F'});
  const q=tsmQuarterFacts(quarterHtml,'1046179',quarter);const r=parse(mergeFinancialFacts(p,[q],'1046179'));
  assert.equal(r.status,'ready');assert.equal(r.quarterRevenue.end,'2026-06-30');
  q.facts['ifrs-full'].Revenue.units.TWD[0].start='2026-01-01';
  assert.equal(parse(mergeFinancialFacts(p,[q],'1046179')).quarterRevenue,null);
});
test('reviewed quarterly statements supersede rounded release amounts and keep a current same-filing balance',()=>{
  const statement={...quarter,accession:'0001046179-26-000541',filed:'2026-08-14'};
  const p=tsmStatementFacts(statementHtml,'1046179',statement);
  const r=parse(mergeFinancialFacts(inlineFinancialFacts(annualHtml,'1046179',annual),[tsmQuarterFacts(quarterHtml,'1046179',quarter),p],'1046179'));
  assert.equal(r.quarterRevenue.value,1270380250000);assert.equal(r.previousQuarterRevenue.value,933791869000);
  assert.equal(r.quarterOperatingIncome.value,766602651000);assert.equal(r.quarterRevenue.filed,'2026-08-14');
  assert.equal(r.balance.cash.value,3134218213000);assert.equal(r.balance.currentAssets.value,4565700742000);assert.equal(r.balance.currentLiabilities.value,1857761825000);
  assert.equal(r.balance.end,'2026-06-30');assert.equal(r.balance.filed,'2026-08-14');
  assert.equal(tsmStatementFacts(statementHtml.replace('For the Three Months Ended June 30','For the Six Months Ended June 30'),'1046179',statement),null);
  assert.equal(tsmStatementFacts(statementHtml.replaceAll('New Taiwan Dollars','US Dollars'),'1046179',statement),null);
});
test('consolidated income statement identifies total revenue instead of rejecting real financing revenue differences',()=>{
 const f={...annual,accession:'0001628280-26-006516',form:'10-K',filed:'2026-02-09'};
 const p=inlineFinancialFacts(bloomHtml,'1664703',f);
 assert.equal(p.primaryRevenueTag,'us-gaap:Revenues');
 p.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax={units:{USD:[{val:2001614000,start:'2025-01-01',end:'2025-12-31',filed:f.filed,accn:f.accession,form:f.form}]}};
 assert.equal(extractFinancials('BE','1664703',p,now).status,'unsupported');
 const r=extractFinancials('BE','1664703',p,now,undefined,p.primaryRevenueTag);
 assert.equal(r.status,'ready');assert.equal(r.revenue.value,2023994000);assert.equal(r.operatingIncome.value,72802000);
 assert.equal(inlineFinancialFacts(bloomHtml.replaceAll('Net loss per share','Measure').replaceAll('basic and diluted','unavailable'),'1664703',f).primaryRevenueTag,undefined);
});
test('a newer Item 2.02 release prevents older quarterly data from being represented as verified latest results',async()=>{
 const s=structuredClone(submission),cols=s.filings.recent;
 for(const [key,value] of Object.entries({accessionNumber:'0001046179-26-000999',form:'8-K',filingDate:'2026-09-30',reportDate:'2026-09-30',primaryDocument:'earnings.htm',isInlineXBRL:1}))cols[key].unshift(value);
 cols.items=['2.02,9.01','',''];
 const fetcher=upstream();const r=await loadSecComparison('TSM','1046179',url=>url.includes('/submissions/') ? Promise.resolve(JSON.stringify(s)) : fetcher(url),now);
 assert.equal(r.quarterRevenue.end,'2026-06-30');assert.ok(r.dataWarnings.some(w=>w.en.includes('newer earnings release')));
});
