import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = (await readFile(new URL("../app/api/research/stocks/route.ts", import.meta.url), "utf8"))
  .replaceAll("@/lib/research/chain-network.server", new URL("../lib/research/chain-network.server.ts", import.meta.url).href)
  .replaceAll("@/lib/research/company-introductions", new URL("../lib/research/company-introductions.ts", import.meta.url).href)
  .replaceAll("@/lib/research/annual-filing-briefs", new URL("../lib/research/annual-filing-briefs.ts", import.meta.url).href)
  .replaceAll("@/lib/research/stock-directory", new URL("../lib/research/stock-directory.ts", import.meta.url).href);
const { GET } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));

test("large SEC profiles retain their industry while directory and profile limits stay bounded", async () => {
  const originalFetch = globalThis.fetch;
  const directory = { fields: ["cik", "name", "ticker", "exchange"], data: Array.from({ length: 120 }, (_, i) => [1000000 + i, `Example ${i}`, `X${i}`, "NYSE"]) };
  directory.data.push([19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"]);
  let profilePadding = 4_600_000;
  let directoryPadding = 0;
  globalThis.fetch = async url => Response.json(String(url).includes("company_tickers")
    ? { ...directory, padding: "x".repeat(directoryPadding) }
    : { cik: "0000019617", sic: "6021", sicDescription: "National Commercial Banks", padding: "x".repeat(profilePadding) });
  const request = () => GET(new Request("https://example.test/api/research/stocks?ticker=JPM"));
  try {
    const valid = await request();
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).profile.sic, "6021");
    profilePadding = 10_000_001;
    const oversizedProfile = await request();
    assert.equal(oversizedProfile.status, 503);
    assert.equal((await oversizedProfile.json()).error, "sec-response-too-large");
    profilePadding = 0;
    directoryPadding = 2_000_001;
    const oversizedDirectory = await request();
    assert.equal(oversizedDirectory.status, 503);
    assert.equal((await oversizedDirectory.json()).error, "sec-response-too-large");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profile API returns only the selected issuer's introduction and never matches a reused ticker", async () => {
  const originalFetch = globalThis.fetch;
  let cik = 1045810;
  globalThis.fetch = async url => Response.json(String(url).includes("company_tickers")
    ? {fields:["cik","name","ticker","exchange"],data:[[cik,"NVIDIA","NVDA","Nasdaq"],...Array.from({length:120},(_,i)=>[2000000+i,`Example ${i}`,`X${i}`,"NYSE"])]}
    : {cik:String(cik),sic:"3674"});
  try {
    const request = () => GET(new Request("https://example.test/api/research/stocks?ticker=NVDA"));
    const covered = await (await request()).json();
    assert.equal(covered.profile.introduction.name,"NVIDIA");
    assert.equal(covered.profile.network.root,"NVDA");
    assert.equal(covered.profile.introduction.ja.revenue.includes("データセンター"),true);
    assert.equal(JSON.stringify(covered).includes('"name":"Costco"'),false);
    cik = 9999999;
    const reused = await (await request()).json();
    assert.equal(reused.profile.introduction,null);
    assert.equal(reused.profile.network,null);
  } finally { globalThis.fetch = originalFetch; }
});
