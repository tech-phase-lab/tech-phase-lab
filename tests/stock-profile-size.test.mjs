import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = (await readFile(new URL("../app/api/research/stocks/route.ts", import.meta.url), "utf8"))
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
