import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeTwelveComparison, twelveNumber, comparablePER, prepareTwelveComparison } from "../lib/research/twelve-data-comparison.ts";
const now = Date.parse("2026-10-04T12:00:00Z");
// Synthetic schema fixtures, not claimed live MU/AAOI financial data.
const income = (rows = [{ fiscal_date:"2026-08-31",quarter:4,year:2026,sales:120,operating_income:24,eps_diluted:2 },
  { fiscal_date:"2025-08-31",quarter:4,year:2025,sales:100 }]) => ({meta:{symbol:"MU",currency:"USD",period:"Quarterly"},income_statement:rows});
const cash = () => ({meta:{symbol:"MU",currency:"USD",period:"Quarterly"},cash_flow:[{
  fiscal_date:"2026-08-31",quarter:"4",year:2026,
  operating_activities:{operating_cash_flow:30},investing_activities:{capital_expenditures:-12},free_cash_flow:999 }]});
test("provider numbers preserve signs and units without converting missing values to zero", () => {
  for(const x of [null,undefined,"", " ",false,true,"1,000","29K","12%",Infinity,"Infinity",{}]) assert.equal(twelveNumber(x),null);
  assert.equal(twelveNumber("-0.02"),-.02); assert.equal(twelveNumber("1.2e3"),1200); assert.equal(twelveNumber(0),0);
});
test("normalization distinguishes period end and release; calculates same-quarter YoY and signed FCF", () => {
  const s=normalizeTwelveComparison("MU",income(),cash(),now);
  assert.equal(s.periodEnd,"2026-08-31"); assert.equal(s.releasedAt,null);
  assert.equal(s.retrievedAt,"2026-10-04T12:00:00.000Z");
  assert.equal(s.revenueGrowthPct,20); assert.equal(s.operatingMarginPct,20);
  assert.equal(s.freeCashFlow,18); assert.equal(s.freeCashFlowMarginPct,15);
});
test("missing latest-quarter values never fall back to a previous quarter or become zero", () => {
  const s=normalizeTwelveComparison("MU",income([{fiscal_date:"2026-08-31",quarter:4,year:2026,sales:null},
    {fiscal_date:"2026-05-31",quarter:3,year:2026,sales:90,operating_income:20}]),cash(),now);
  assert.equal(s.periodEnd,"2026-08-31"); assert.equal(s.revenue,null); assert.equal(s.operatingMarginPct,null);
  assert.equal(s.revenueGrowthPct,null);
});
test("losses stay negative and wrong symbols, annual periods and invalid dates are rejected", () => {
  const i=income(); i.income_statement[0].operating_income=-12;
  assert.equal(normalizeTwelveComparison("MU",i,null,now).operatingMarginPct,-10);
  assert.throws(()=>normalizeTwelveComparison("AAOI",i,null,now));
  i.meta.period="Annual"; assert.throws(()=>normalizeTwelveComparison("MU",i,null,now));
  assert.throws(()=>normalizeTwelveComparison("MU",income([{fiscal_date:"2026-02-30",quarter:1,year:2026}]),null,now));
});
test("conflicting duplicates, a wrong cash-flow currency and positive capex cannot generate a false FCF", () => {
  const i=income(); i.income_statement.push({...i.income_statement[0],sales:121});
  assert.equal(normalizeTwelveComparison("MU",i,cash(),now).revenue,null);
  const c=cash(); c.meta.currency="TWD";
  assert.equal(normalizeTwelveComparison("MU",income(),c,now).freeCashFlow,null);
  c.meta.currency="USD"; c.cash_flow[0].investing_activities.capital_expenditures=12;
  const s=normalizeTwelveComparison("MU",income(),c,now);
  assert.equal(s.freeCashFlow,null); assert.ok(s.warnings.includes("capex-sign-unverified"));
});
test("cash flow from another quarter is not substituted",()=>{
  const c=cash(); c.cash_flow[0].fiscal_date="2026-05-31";
  assert.equal(normalizeTwelveComparison("MU",income(),c,now).freeCashFlow,null);
});
test("PER separates forecast/TTM, loss/zero EPS, currency and ADR share basis", () => {
  const base={price:120,eps:6,kind:"forward",priceCurrency:"USD",epsCurrency:"USD",sameShareBasis:true};
  assert.deepEqual(comparablePER(base),{kind:"forward",value:20,status:"ready"});
  for(const eps of [0,-2]) assert.equal(comparablePER({...base,eps}).status,"not-meaningful");
  for(const override of [{eps:null},{epsCurrency:"TWD"},{sameShareBasis:false},{price:0}])
    assert.equal(comparablePER({...base,...override}).status,"unavailable");
});
test("saved bilingual evidence is reused for unchanged facts and invalidated for corrections",()=>{
  const s=normalizeTwelveComparison("MU",income(),cash(),now), prepared=prepareTwelveComparison(s,undefined,now);
  assert.equal(prepared.items.length,3);
  assert.match(prepared.items[0].short.ja,/\+20\.0%/); assert.match(prepared.items[0].short.en,/\+20\.0%/);
  const reuse=prepareTwelveComparison({...s,retrievedAt:new Date(now+1000).toISOString()},prepared,now+1000);
  assert.equal(reuse.preparedAt,prepared.preparedAt); assert.equal(reuse.revision,prepared.revision);
  const changed=prepareTwelveComparison({...s,revenueGrowthPct:-10},prepared,now+2000);
  assert.notEqual(changed.revision,prepared.revision); assert.equal(changed.items[0].kind,"weakness");
  assert.match(changed.items[0].short.ja,/-10\.0%/); assert.match(changed.items[0].short.en,/-10\.0%/);
});
test("ingestion cache reuses prepared text across repeated reads and updates on new evidence",async()=>{
  let text=await readFile(new URL("../lib/research/twelve-data-comparison-server.ts",import.meta.url),"utf8");
  const moduleURL=new URL("../lib/research/twelve-data-comparison.ts",import.meta.url).href;
  text=text.replace('import "server-only";','').replace('import { unstable_cache } from "next/cache";',`const values=new Map();
    const unstable_cache=(fn,keys)=>async()=>{const key=JSON.stringify(keys); if(!values.has(key))values.set(key,await fn());return values.get(key);};`)
    .replace('"./twelve-data-comparison"',JSON.stringify(moduleURL));
  // Node's TS stripping is only needed for the typed function parameters.
  const {stripTypeScriptTypes}=await import("node:module");
  const mod=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`);
  const a=await mod.prepareTwelveComparisonPayload("MU",income(),cash());
  const b=await mod.prepareTwelveComparisonPayload("MU",income(),cash());
  assert.equal(a.preparedAt,b.preparedAt); assert.equal(a.revision,b.revision);
  const i=income();i.income_statement[0].sales=150;
  const c=await mod.prepareTwelveComparisonPayload("MU",i,cash()); assert.notEqual(a.revision,c.revision);
});
