// Exchange-traded notes (ETNs) are not offered by the Stock Comparison (owner, Nov 20). The SEC's ticker list files an ETN under the bank
// that issues it (VXX under Barclays Bank PLC, BDCZ under UBS AG, DGZ under Deutsche Bank, FNGU under Bank of Montreal), so the comparison
// scored the note with the bank's own figures; the Nov 20 audit found 19 of them with strengths only. The banks' own shares stay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { comparisonExclusion, comparableEntries, tickersByCik, COMPARISON_EXCLUSIONS } from "../lib/research/comparison-exclusions.ts";

const lists = JSON.parse(readFileSync(new URL("../lib/research/comparison-exclusions.json", import.meta.url), "utf8"));
// As the SEC lists them (company_tickers_exchange.json, Nov 20).
const row = (cik, name, exchange, ...tickers) => tickers.map(ticker => ({ ticker, cik, name, exchange }));
const directory = [
  ...row(1114446, "UBS AG", "NYSE", "AMUB", "BDCX", "BDCZ", "CEFD", "HDLB", "IFED", "MLPB", "MLPR", "MVRL", "PFFL", "SMHB", "UCIB"),
  ...row(312070, "BARCLAYS BANK PLC", "CBOE", "ATMP", "TAPR", "VXX", "VXZ"), ...row(312070, "BARCLAYS BANK PLC", "NYSE", "DJP", "GRN"),
  ...row(312070, "BARCLAYS BANK PLC", "Nasdaq", "GBUG"), ...row(312070, "BARCLAYS BANK PLC", "OTC", "BWVTF", "JJETF"),
  ...row(1053092, "CREDIT SUISSE AG", "Nasdaq", "GLDI", "SLVO", "USOI"),
  ...row(1159508, "DEUTSCHE BANK AKTIENGESELLSCHAFT", "NYSE", "DB", "DGP", "DGZ", "DZZ"), ...row(1159508, "DEUTSCHE BANK AKTIENGESELLSCHAFT", "OTC", "ADZCF", "DEENF", "OLOXF"),
  ...row(927971, "BANK OF MONTREAL /CAN/", "NYSE", "BMO", "FNGD", "FNGU", "FNGO", "FNGS", "BNKU", "BNKD", "BULZ", "BERZ", "OILU", "OILD", "GDXU", "GDXD", "SPYU"),
  ...row(927971, "BANK OF MONTREAL /CAN/", "CBOE", "BRZL", "BRZD", "JPNU", "JPND", "TAWN", "TPEI", "SMHU", "SMHD"),
  ...row(19617, "JPMORGAN CHASE & CO", "NYSE", "JPM", "JPM-PC", "AMJB", "VYLD"),
  ...row(886982, "GOLDMAN SACHS GROUP INC", "NYSE", "GS", "GS-PA"), ...row(886982, "GOLDMAN SACHS GROUP INC", "OTC", "GSCE"),
  ...row(895421, "MORGAN STANLEY", "NYSE", "MS", "MS-PK"), ...row(831001, "CITIGROUP INC", "NYSE", "C", "C-PN"),
  // The banks' own shares and their parents (another CIK), and other banks with more than one ticker.
  ...row(1610520, "UBS Group AG", "NYSE", "UBS"), ...row(312069, "BARCLAYS PLC", "NYSE", "BCS"), ...row(312069, "BARCLAYS PLC", "OTC", "BCLYF"),
  ...row(1000275, "ROYAL BANK OF CANADA", "NYSE", "RY"), ...row(1000275, "ROYAL BANK OF CANADA", "OTC", "RYLBF"),
  ...row(1089113, "HSBC HOLDINGS PLC", "NYSE", "HSBC"), ...row(1163653, "NOMURA HOLDINGS INC", "NYSE", "NMR"), ...row(70858, "BANK OF AMERICA CORP /DE/", "NYSE", "BAC"),
  ...row(2103612, "Morgan Stanley Bitcoin Trust", "NYSE", "MSBT"),
];
const ETNS = ["AMUB", "BDCX", "BDCZ", "CEFD", "HDLB", "IFED", "MLPB", "MLPR", "MVRL", "PFFL", "SMHB", "UCIB", "ATMP", "TAPR", "VXX", "VXZ", "DJP", "GRN", "GBUG",
  "BWVTF", "JJETF", "GLDI", "SLVO", "USOI", "DGP", "DGZ", "DZZ", "ADZCF", "DEENF", "OLOXF", "FNGD", "FNGU", "FNGO", "FNGS", "BNKU", "BNKD", "BULZ", "BERZ", "OILU",
  "OILD", "GDXU", "GDXD", "SPYU", "BRZL", "BRZD", "JPNU", "JPND", "TAWN", "TPEI", "SMHU", "SMHD", "AMJB", "VYLD", "GSCE"];
// RYLBF was listed here as Royal Bank's OTC share; it is its first preferred (the provider's reference list, Nov 26: "ROYAL BK CDA 1ST
// PFD BO"), now left out as a preferred (comparison-exclusions.json "instrument").
const SHARES = ["DB", "BMO", "JPM", "GS", "MS", "C", "UBS", "BCS", "BCLYF", "RY", "HSBC", "NMR", "BAC"];
const kind = (entries, ticker) => comparisonExclusion(entries.find(e => e.ticker === ticker), tickersByCik(entries), lists);

test("ETNs filed under the issuing bank are not offered; the banks' own shares and their parents' are", () => {
  for (const t of ETNS) assert.equal(kind(directory, t), "etn", t);
  for (const t of SHARES) assert.equal(kind(directory, t), null, t);
  // Unchanged: a bank's preferred is a preferred, a Morgan Stanley crypto trust a fund.
  assert.equal(kind(directory, "RYLBF"), "preferred");
  assert.equal(kind(directory, "JPM-PC"), "preferred"); assert.equal(kind(directory, "GS-PA"), "preferred"); assert.equal(kind(directory, "MSBT"), "fund");
  assert.deepEqual(comparableEntries(directory, lists).map(e => e.ticker), SHARES);
  // The list the app uses is this file.
  assert.deepEqual(COMPARISON_EXCLUSIONS.etn, lists.etn);
});

test("the ETN issuers are matched by CIK, which names one legal entity for good, and each lists its own shares", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(lists.etn).map(([cik, i]) => [cik, i.shares])), {
    19617: ["JPM"], 200245: [], 312070: [], 831001: ["C"], 886982: ["GS"], 895421: ["MS"], 927971: ["BMO"], 1053092: [], 1114446: [], 1159508: ["DB"],
    1419828: [], 1665650: [], 1666268: [],
  });
  // A renamed issuer (Credit Suisse AG is now part of UBS) still issues the same notes; a new note under a listed issuer is caught as well.
  assert.equal(comparisonExclusion({ ticker: "GLDI", cik: "0001053092", name: "UBS AG (Credit Suisse)", exchange: "Nasdaq" }, new Map(), lists), "etn");
  assert.equal(comparisonExclusion({ ticker: "NEWU", cik: 927971, name: "BANK OF MONTREAL /CAN/", exchange: "NYSE" }, new Map(), lists), "etn");
  // The same ticker under another company is offered.
  assert.equal(comparisonExclusion({ ticker: "CARD", cik: 1, name: "Card Co.", exchange: "NYSE" }, new Map(), lists), null);
});

async function server(entries) {
  const text = readFileSync(new URL("../lib/research/comparison-server.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace('import { unstable_cache } from "next/cache";', "const unstable_cache = fn => async (...a) => fn(...a);")
    .replace(/import \{ comparisonCatalog \}[^;]*;/, "const comparisonCatalog = [];")
    .replace(/import providers from[^;]*;/, "const providers = [];")
    .replace(/import \{ parseSecDirectory \}[^;]*;/, "const parseSecDirectory = () => globalThis.__etn.entries;")
    .replace(/import \{ (?!COMPARISON_EXCLUSIONS)[^}]*\} from "\.\/[^"]*";/g, "")
    .replace('"./comparison-exclusions"', JSON.stringify(new URL("../lib/research/comparison-exclusions.ts", import.meta.url).href))
    .replace(/import type \{ Financials \}[^;]*;/, "");
  globalThis.__etn = { entries };
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
}

test("an ETN asked for directly is an unknown company, and the background job spends no statement credits on it", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}");
  try {
    const { resolveComparisonCompany, statementsNeeded } = await server(directory);
    for (const t of ["VXX", "BDCZ", "DGZ", "FNGU", "GLDI", "AMJB", "GSCE"]) {
      assert.equal(await resolveComparisonCompany(t), null, t);
      assert.equal((await statementsNeeded(t)).needs, false, t);
    }
    for (const t of ["DB", "BMO", "JPM", "GS", "UBS", "BCS"]) assert.equal((await resolveComparisonCompany(t))?.name, directory.find(e => e.ticker === t).name, t);
  } finally { globalThis.fetch = realFetch; }
});
