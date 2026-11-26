// Listings that are not an operating company's share are not offered by the Stock Comparison (Nov 26 coverage audit: 254 exchange tickers
// and 317 over the counter were still offered, scored with the issuer's figures or with none): preferreds and baby bonds the ticker rules
// do not recognise, ETNs, warrants and units with other suffixes, royalty trusts, registered closed-end funds and blank-check shells. The
// list is lib/research/comparison-exclusions.json, built by scripts/research/comparison-audit/instruments.py from the provider's free
// reference list and the SEC's filings. Operating companies keep being offered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comparisonExclusion, tickersByCik } from "../lib/research/comparison-exclusions.ts";
import { warmUniverse } from "../lib/research/twelve-warm-plan.ts";

const lists = JSON.parse(readFileSync(new URL("../lib/research/comparison-exclusions.json", import.meta.url), "utf8"));
const rows = [
  { ticker: "SO", cik: 92122, name: "SOUTHERN CO", exchange: "NYSE" }, { ticker: "SOJD", cik: 92122, name: "SOUTHERN CO", exchange: "NYSE" },
  { ticker: "SOMN", cik: 92122, name: "SOUTHERN CO", exchange: "NYSE" },
  { ticker: "T", cik: 732717, name: "AT&T INC.", exchange: "NYSE" }, { ticker: "TBB", cik: 732717, name: "AT&T INC.", exchange: "NYSE" },
  { ticker: "OPEN", cik: 1801169, name: "Opendoor Technologies Inc.", exchange: "Nasdaq" }, { ticker: "OPENZ", cik: 1801169, name: "Opendoor Technologies Inc.", exchange: "Nasdaq" },
  { ticker: "KTN", cik: 1173891, name: "STRUCTURED PRODUCTS CORP CRED ENHAN", exchange: "NYSE" },
  { ticker: "PBT", cik: 77877, name: "PERMIAN BASIN ROYALTY TRUST", exchange: "NYSE" },
  { ticker: "TPL", cik: 1811074, name: "Texas Pacific Land Corp", exchange: "NYSE" },
  { ticker: "NVDA", cik: 1045810, name: "NVIDIA CORP", exchange: "Nasdaq" }, { ticker: "IMUX", cik: 1280776, name: "IMMUNIC, INC.", exchange: "Nasdaq" },
  { ticker: "JPM", cik: 19617, name: "JPMORGAN CHASE & CO", exchange: "NYSE" }, { ticker: "ARCC", cik: 1287750, name: "ARES CAPITAL CORP", exchange: "Nasdaq" },
  { ticker: "NWSA", cik: 1564708, name: "NEWS CORP", exchange: "Nasdaq" }, { ticker: "NWS", cik: 1564708, name: "NEWS CORP", exchange: "Nasdaq" },
];
const kind = ticker => comparisonExclusion(rows.find(r => r.ticker === ticker), tickersByCik(rows), lists);

test("preferreds, notes, warrants, units and royalty trusts that no ticker rule recognises are not offered", () => {
  assert.equal(kind("SOJD"), "preferred"); assert.equal(kind("TBB"), "preferred"); assert.equal(kind("KTN"), "preferred");
  assert.equal(kind("OPENZ"), "warrant"); assert.equal(kind("SOMN"), "unit"); assert.equal(kind("PBT"), "trust");
});

test("operating companies, banks, BDCs, land companies and every class share stay", () => {
  for (const t of ["SO", "T", "OPEN", "TPL", "NVDA", "IMUX", "JPM", "ARCC", "NWSA", "NWS"]) assert.equal(kind(t), null, t);
});

test("the list never names a ticker of the curated comparison set", () => {
  const providers = JSON.parse(readFileSync(new URL("../lib/research/providers.json", import.meta.url), "utf8"));
  for (const p of providers) assert.equal(lists.instrument[p.ticker], undefined, p.ticker);
});

test("NWS (News Corp class B) is in the background job's universe: WS ends a warrant only after a hyphen or on five letters", () => {
  const universe = warmUniverse([{ ticker: "NWSA", cik: 1564708, exchange: "Nasdaq" }, { ticker: "NWS", cik: 1564708, exchange: "Nasdaq" },
    { ticker: "ACAH", cik: 1, exchange: "NYSE" }, { ticker: "ACAH-WS", cik: 1, exchange: "NYSE" }, { ticker: "ABC", cik: 2, exchange: "Nasdaq" }, { ticker: "ABCWS", cik: 2, exchange: "Nasdaq" }]);
  assert.ok(universe.includes("NWS"));
  assert.ok(!universe.includes("ACAH-WS")); assert.ok(!universe.includes("ABCWS"));
});
