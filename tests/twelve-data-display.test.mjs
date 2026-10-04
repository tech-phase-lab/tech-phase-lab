import test from "node:test";
import assert from "node:assert/strict";
import { buildTwelveFinancials, prepareTwelveDisplay } from "../lib/research/twelve-data-financials.ts";
import { comparisonScores, comparisonMetric, comparisonLeaders, radarPoint } from "../lib/research/comparison-scorecard.ts";
import { currentComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const now=Date.parse("2026-10-04T10:00:00Z"),at=new Date(now).toISOString();
function bundle(ticker="AAA",forwardPE=20) {
  const periods=["2026-08-31","2026-05-31","2026-02-28","2025-11-30","2025-08-31"];
  return {ticker,retrievedAt:at,accountingBasis:"us-gaap",
    income:{meta:{symbol:ticker,currency:"USD",period:"Quarterly"},income_statement:periods.map((fiscal_date,i)=>({fiscal_date,quarter:[4,3,2,1,4][i],year:i<4?2026:2025,sales:i===4?100:120,operating_income:i===4?20:24,eps_diluted:2}))},
    cashFlow:{meta:{symbol:ticker,currency:"USD",period:"Quarterly"},cash_flow:[{fiscal_date:periods[0],quarter:4,year:2026,operating_activities:{operating_cash_flow:30},investing_activities:{capital_expenditures:-12}}]},
    statistics:{retrievedAt:at,payload:{meta:{symbol:ticker,currency:"USD"},statistics:{valuations_metrics:{forward_pe:forwardPE,trailing_pe:24},financials:{most_recent_quarter:periods[0],income_statement:{diluted_eps_ttm:5},balance_sheet:{current_ratio_mrq:2,total_cash_mrq:100,total_debt_mrq:50}}}}},
    series:{retrievedAt:at,adjust:"splits",payload:{meta:{symbol:ticker,currency:"USD",interval:"1day"},values:[{datetime:"2026-10-02",close:"120"},{datetime:"2026-07-03",close:"100"}]}}};
}
test("provider responses reach the exact production radar/bar/JA/EN contract with seven scores",()=>{
  const {financials:c,scores}=prepareTwelveDisplay(bundle(),now);
  assert.equal(c.quarterRevenue.end,"2026-08-31"); assert.equal(c.quarterRevenue.filed,null);assert.equal(c.quarterRevenue.accession,null);
  assert.equal(c.quarterRevenue.start,null); assert.equal(c.revenue,null); // no annual substitution
  assert.deepEqual(scores.map(s=>s.value),[10,4,7,10,7,7,8]);
  assert.ok(scores.every((s,i)=>radarPoint(s.value,i,7)!==null));
  assert.equal(comparisonMetric(c,"valuation","ja",now),"予想PER 20.0×");
  assert.equal(comparisonMetric(c,"valuation","en",now),"Forward P/E 20.0×");
  assert.ok(c.preparedAnalysis.items.some(i=>i.id==="valuation"));
  assert.equal(c.preparedAnalysis.method,"deterministic");
  assert.ok(currentComparisonAnalysis(c,now));
});
test("a missing endpoint leaves the other factors usable; missing does not become zero",()=>{
  const b=bundle();delete b.statistics;delete b.series;
  const c=buildTwelveFinancials(b,now),s=comparisonScores(c,now);
  assert.equal(s.find(x=>x.id==="valuation").value,null);
  assert.equal(s.find(x=>x.id==="financial").value,null);
  assert.equal(s.find(x=>x.id==="momentum").value,null);
  assert.equal(s.find(x=>x.id==="growth").value,7);
  assert.equal(s.find(x=>x.id==="stability").value,10);
});
test("outdated statistics disappear from both graph and prepared highlights, while quarter survives",()=>{
  const c=buildTwelveFinancials(bundle(),now),later=now+48*3600000;
  assert.equal(comparisonScores(c,later).find(s=>s.id==="valuation").value,null);
  assert.equal(comparisonScores(c,later).find(s=>s.id==="growth").value,7);
  assert.ok(!currentComparisonAnalysis(c,later).items.some(i=>i.id==="valuation"));
});
test("nonpositive forward P/E and missing debt never create a cheap-stock or debt-free score",()=>{
  for(const pe of [null,0,-8]) {
    const b=bundle("AAA",pe);delete b.statistics.payload.statistics.financials.balance_sheet.total_debt_mrq;
    const scores=comparisonScores(buildTwelveFinancials(b,now),now);
    assert.equal(scores.find(s=>s.id==="valuation").value,null);assert.equal(scores.find(s=>s.id==="financial").value,null);
  }
});
test("statistics from a different symbol or reporting period cannot fill the current quarter",()=>{
  for(const change of [b=>b.statistics.payload.meta.symbol="BBB",b=>b.statistics.payload.statistics.financials.most_recent_quarter="2026-05-31"]) {
    const b=bundle();change(b);
    assert.equal(buildTwelveFinancials(b,now).twelveData.statistics,null);
  }
});
test("stability needs four consecutive complete quarters, not selected profitable observations",()=>{
  const b=bundle();b.income.income_statement[1].operating_income=null;
  assert.equal(comparisonScores(buildTwelveFinancials(b,now),now).find(s=>s.id==="stability").value,null);
  const negative=bundle();negative.income.income_statement.forEach(r=>r.operating_income=-10);
  assert.equal(comparisonScores(buildTwelveFinancials(negative,now),now).find(s=>s.id==="stability").value,0);
});
test("unadjusted, stale or duplicated price history cannot create momentum",()=>{
  for(const change of [b=>b.series.adjust="none",b=>b.series.payload.values.push({...b.series.payload.values[0]}),b=>b.series.payload.values[0].datetime="2026-08-01"]) {
    const b=bundle();change(b);
    assert.equal(buildTwelveFinancials(b,now).twelveData.momentum,null);
  }
});
test("two/three-company leaders use the displayed score, and cannot win against missing data",()=>{
  const a=buildTwelveFinancials(bundle("AAA",10),now),b=buildTwelveFinancials(bundle("BBB",20),now),c=buildTwelveFinancials(bundle("CCC",30),now);
  assert.deepEqual(comparisonLeaders([a,b],"valuation",now),[true,false]);
  assert.deepEqual(comparisonLeaders([a,b,c],"valuation",now),[true,false,false]);
  c.twelveData.statistics=null;assert.deepEqual(comparisonLeaders([a,b,c],"valuation",now),[false,false,false]);
});
test("the actual cards render seven-axis status, bars, provider metrics and compact bullets in JA/EN",async()=>{
  const require=createRequire(import.meta.url),{transform,loadBindings}=require("next/dist/build/swc");
  await loadBindings();
  const source=await readFile(new URL("../app/research/compare/comparison-visuals.tsx",import.meta.url),"utf8");
  const functions=source.slice(source.indexOf("function StatusChart("),source.indexOf("\nexport {"));
  const scoreURL=new URL("../lib/research/comparison-scorecard.ts",import.meta.url).href;
  const reactURL=pathToFileURL(require.resolve("react")).href;
  const input=`import React from ${JSON.stringify(reactURL)};
    import {comparisonScores,comparisonMetric,comparisonLeaders,comparisonAvailability,hasRecentQuarter,radarPoint} from ${JSON.stringify(scoreURL)};
    const styles=new Proxy({}, {get:(_,key)=>String(key)});const companyColors=["#ddc38a","#9ed8c3","#a5badf"];
    ${functions}\nexport {CompanyScoreCard,ScoreOverview};`;
  const compiled=await transform(input,{filename:"comparison-render-check.tsx",jsc:{parser:{syntax:"typescript",tsx:true},transform:{react:{runtime:"classic"}},target:"es2022"},module:{type:"es6"}});
  const {CompanyScoreCard,ScoreOverview}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
  const companies=["AAA","BBB","CCC"].map((ticker,i)=>({...buildTwelveFinancials(bundle(ticker,10+i*10),now),name:`Example ${ticker}`,peer:"example",caution:{ja:"",en:""}}));
  for(const lang of ["ja","en"]){
    const card=renderToStaticMarkup(React.createElement(CompanyScoreCard,{company:companies[0],lang,now}));
    assert.equal((card.match(/<circle /g)||[]).length,7);
    assert.match(card,/Example AAA（AAA）/);assert.doesNotMatch(card,/null|undefined/);
    assert.ok((card.match(/<li /g)||[]).length<=8);
    const table=renderToStaticMarkup(React.createElement(ScoreOverview,{companies,lang,now}));
    assert.equal((table.match(/class="scoreTrack"/g)||[]).length,21);
    assert.match(table,lang==="ja"?/予想PER 10.0×/:/Forward P\/E 10.0×/);
    assert.match(table,/data-winner="true"/);
  }
});
