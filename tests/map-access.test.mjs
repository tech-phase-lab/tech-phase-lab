import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mapAccess, FREE_SAMPLE_TICKER } from "../lib/research/map-access.ts";
import { chainTickers } from "../lib/research/chain-map-data.ts";

const NOW = 1_000;
const pro = { status: "signed-in", plan: "pro", accessExpiresAt: NOW + 1 };

test("NVDA is the free sample for everyone, without any membership", () => {
  assert.equal(FREE_SAMPLE_TICKER, "NVDA");
  for (const member of [null, { status: "signed-out", plan: "free" }, { status: "unavailable" }, { status: "signed-in", plan: "free" }]) assert.equal(mapAccess(member, "NVDA", NOW), 200);
});

test("every other map needs PRO, and the owner account counts as PRO", () => {
  assert.equal(mapAccess(pro, "MU", NOW), 200);
  assert.equal(mapAccess({ status: "signed-in", plan: "pro", accessExpiresAt: NOW }, "MU", NOW), 403); // window closed
  assert.equal(mapAccess({ status: "signed-in", plan: "free" }, "MU", NOW), 403);
  assert.equal(mapAccess({ status: "signed-in", plan: "free", ownerAccount: true }, "MU", NOW), 200); // owner without a paid plan
  assert.equal(mapAccess({ status: "signed-in", plan: "pro", ownerAccount: true, accessExpiresAt: NOW + 5 }, "MU", NOW), 200);
  assert.equal(mapAccess({ status: "signed-out", plan: "free" }, "MU", NOW), 401);
  assert.equal(mapAccess({ status: "unavailable" }, "MU", NOW), 503);
  assert.equal(mapAccess(null, "MU", NOW), 503);
});

test("the maps are served only by the gated route: no screen code imports the map registry", () => {
  const offenders = [];
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && !path.includes("/api/") && readFileSync(path, "utf8").includes("chain-map-data")) offenders.push(path);
  } };
  walk(new URL("../app", import.meta.url).pathname);
  assert.deepEqual(offenders, []);
  const route = readFileSync(new URL("../app/api/research/chain-map/route.ts", import.meta.url), "utf8");
  assert.match(route, /mapAccess\(member, ticker\)/);
  assert.match(route, /ticker === FREE_SAMPLE_TICKER \? null : await getMembership\(\)/);
});

test("the public profile response only says that a map exists", async () => {
  const { companyNetworkPlaceholderFor } = await import("../lib/research/chain-network.server.ts");
  const placeholder = companyNetworkPlaceholderFor({ cik: 1045810, ticker: "NVDA" });
  assert.deepEqual(placeholder, { root: "NVDA", nodes: [], edges: [], status: "pending", chained: true });
  assert.equal(JSON.stringify(placeholder).includes("quote"), false);
  assert.ok(chainTickers().length >= 470);
  assert.equal(companyNetworkPlaceholderFor({ cik: 1, ticker: "ZZZZ" }), null);
});
