import assert from "node:assert/strict";
import test from "node:test";
import { radarFacts } from "../lib/research/radar-facts.ts";

let filed = 0;
const row = (end, val, start, form = "10-Q") => ({ ...(start ? { start } : {}), end, val, form, filed: `2027-01-${String(10 + (filed++ % 15)).padStart(2, "0")}` });
const facts = tags => ({ facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows } }])) } });
const NOW = Date.parse("2027-02-01T00:00:00Z");

/** A fiscal-year company: FY2025 (calendar), Q1/H1 2026 and the same periods of 2025. */
const yearEnd = () => facts({
  RevenueFromContractWithCustomerExcludingAssessedTax: [row("2025-12-31", 100, "2025-01-01", "10-K"), row("2024-12-31", 80, "2024-01-01", "10-K")],
  NetCashProvidedByUsedInOperatingActivities: [row("2025-12-31", 30, "2025-01-01", "10-K"), row("2024-12-31", 20, "2024-01-01", "10-K")],
  PaymentsToAcquirePropertyPlantAndEquipment: [row("2025-12-31", 10, "2025-01-01", "10-K"), row("2024-12-31", 8, "2024-01-01", "10-K")],
  CashAndCashEquivalentsAtCarryingValue: [row("2025-12-31", 50, undefined, "10-K"), row("2024-12-31", 30, undefined, "10-K")],
  ShortTermInvestments: [row("2025-12-31", 10, undefined, "10-K"), row("2024-12-31", 10, undefined, "10-K")],
  LongTermDebtNoncurrent: [row("2025-12-31", 20, undefined, "10-K"), row("2024-12-31", 20, undefined, "10-K")],
  DebtCurrent: [row("2025-12-31", 5, undefined, "10-K"), row("2024-12-31", 5, undefined, "10-K")],
  OperatingLeaseLiability: [row("2025-12-31", 5, undefined, "10-K"), row("2024-12-31", 5, undefined, "10-K")],
});

test("a fiscal year end uses the whole year: free cash flow = operating cash flow - capex, cover = cash + short-term investments over borrowings + leases", () => {
  const result = radarFacts(yearEnd(), NOW);
  assert.equal(result.latest?.end, "2025-12-31");
  assert.equal(result.latest?.basis, "annual");
  assert.equal(result.latest?.fcfMargin, 20);
  assert.equal(result.latest?.ocfMargin, 30);       // operating cash flow 30 on revenue 100
  assert.equal(result.latest?.cover, 2);            // (50 + 10) / (20 + 5 + 5)
  assert.equal(result.latest?.revenueGrowth, 25);   // 100 / 80
  assert.equal(result.previous?.end, "2024-12-31"); assert.equal(result.previous?.fcfMargin, 15);
  assert.equal(result.previous?.revenueGrowth, null); // no 2023 revenue
});

test("between year ends the trailing four quarters are used, and the basis says so", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  t.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push(row("2026-06-30", 60, "2026-01-01"), row("2025-06-30", 45, "2025-01-01"), row("2025-06-30", 90, "2024-07-01", "10-K"));
  t.NetCashProvidedByUsedInOperatingActivities.units.USD.push(row("2026-06-30", 18, "2026-01-01"), row("2025-06-30", 12, "2025-01-01"));
  t.PaymentsToAcquirePropertyPlantAndEquipment.units.USD.push(row("2026-06-30", 6, "2026-01-01"), row("2025-06-30", 4, "2025-01-01"));
  for (const tag of ["CashAndCashEquivalentsAtCarryingValue", "ShortTermInvestments", "LongTermDebtNoncurrent", "DebtCurrent", "OperatingLeaseLiability"]) t[tag].units.USD.push(row("2026-06-30", t[tag].units.USD[0].val, undefined));
  const result = radarFacts(data, NOW);
  assert.equal(result.latest?.end, "2026-06-30"); assert.equal(result.latest?.basis, "ttm");
  assert.equal(result.latest?.revenue, 115);                      // 100 + 60 - 45
  assert.equal(Math.round(result.latest.fcfMargin * 100) / 100, 20.87); // (30 + 18 - 12) - (10 + 6 - 4) = 24 / 115
  assert.equal(result.previous?.end, "2025-12-31");               // the previous earnings
});

test("LongTermDebt stands for the non-current part when no explicit non-current line exists", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  delete t.LongTermDebtNoncurrent;
  t.LongTermDebt = { units: { USD: [row("2025-12-31", 20, undefined, "10-K"), row("2024-12-31", 20, undefined, "10-K")] } };
  assert.equal(radarFacts(data, NOW).latest?.cover, 2);
});

test("a company that has borrowed nothing for a year has unlimited cover", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  for (const tag of ["LongTermDebtNoncurrent", "DebtCurrent", "OperatingLeaseLiability"]) delete t[tag];
  assert.equal(radarFacts(data, NOW).latest?.cover, Number.POSITIVE_INFINITY);
});

test("a company whose debt lines vanish is not called debt-free while it still reports borrowings", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  for (const tag of ["LongTermDebtNoncurrent", "DebtCurrent", "OperatingLeaseLiability"]) delete t[tag];
  t.RepaymentsOfDebt = { units: { USD: [row("2025-12-31", 3, "2025-01-01", "10-K")] } };
  assert.notEqual(radarFacts(data, NOW).latest?.end, "2025-12-31");
});

test("without capital spending or operating cash flow nothing is made up", () => {
  const data = yearEnd(); delete data.facts["us-gaap"].PaymentsToAcquirePropertyPlantAndEquipment;
  const result = radarFacts(data, NOW);
  assert.equal(result.latest, null); assert.equal(result.reason, "not-derivable");
  assert.equal(radarFacts({}, NOW).latest, null);
});

test("an amended restatement replaces the original figure", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  t.NetCashProvidedByUsedInOperatingActivities.units.USD.push({ ...row("2025-12-31", 40, "2025-01-01", "10-K/A"), filed: "2027-01-30" });
  assert.equal(radarFacts(data, NOW).latest?.fcfMargin, 30);
});

test("revenue, operating cash flow and capex must cover the same twelve months", () => {
  // Operating cash flow is only known as a fiscal year while revenue has a newer year-to-date: no mixing of periods.
  const data = yearEnd(), t = data.facts["us-gaap"];
  t.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push(row("2026-06-30", 60, "2026-01-01"), row("2025-06-30", 45, "2025-01-01"), row("2025-06-30", 90, "2024-07-01", "10-K"));
  for (const tag of ["CashAndCashEquivalentsAtCarryingValue", "ShortTermInvestments", "LongTermDebtNoncurrent", "DebtCurrent", "OperatingLeaseLiability"]) t[tag].units.USD.push(row("2026-06-30", t[tag].units.USD[0].val, undefined));
  const result = radarFacts(data, NOW);
  assert.equal(result.latest?.end, "2025-12-31");   // 2026-06-30 has revenue to date but no matching cash flow
  assert.equal(result.latest?.basis, "annual");
});

test("a company with no revenue at all is shown with a stand-in, not left out and not given a made-up margin", () => {
  const data = yearEnd();
  delete data.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax;
  const result = radarFacts(data, NOW);
  assert.equal(result.latest?.noRevenue, true);
  assert.equal(result.latest?.revenue, 0);
  assert.equal(result.latest?.ocfMargin, -1000);
  assert.equal(result.latest?.cover, 2);
  assert.equal(result.latest?.revenueGrowth, null);
});

test("revenue that cannot be added up to twelve months counts as none, but a mismatch of periods is not that", () => {
  const data = yearEnd(), t = data.facts["us-gaap"];
  t.Revenues = { units: { USD: [row("2025-09-30", 25, "2025-07-01")] } }; // a lone quarter: no twelve months to be had
  delete t.RevenueFromContractWithCustomerExcludingAssessedTax;
  assert.equal(radarFacts(data, NOW).latest?.noRevenue, true);
  // revenue of a full year that does not match the cash-flow period stays "not derivable", never "no revenue"
  const mixed = yearEnd();
  mixed.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push(row("2026-06-30", 60, "2026-01-01"), row("2025-06-30", 45, "2025-01-01"), row("2025-06-30", 90, "2024-07-01", "10-K"));
  for (const tag of ["CashAndCashEquivalentsAtCarryingValue", "ShortTermInvestments", "LongTermDebtNoncurrent", "DebtCurrent", "OperatingLeaseLiability"]) mixed.facts["us-gaap"][tag].units.USD.push(row("2026-06-30", mixed.facts["us-gaap"][tag].units.USD[0].val, undefined));
  assert.equal(radarFacts(mixed, NOW).latest?.noRevenue, undefined);
});
