// Speed, Nov 26: ハイテク速報 and 注目トピック draw a signed-out visitor's FREE view into the first HTML (lib/research/news-first-paint.ts).
// The loader is run here with the session and the monitor replaced: a visitor gets only the FREE projection (30 minutes behind, the latest
// five, headlines only); any browser with a session gets nothing drawn (these pages run without the identity proxy, owner Oct 21).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-12T11:11:00Z");
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const SECRET = "PAID-BODY-TEXT";
const item = (id, minutes) => ({ id, title: `T ${id}`, url: `https://example.com/n/${id}`, publisher: "Pub", tickers: ["MU"], publishedAt: ago(minutes), observedAt: ago(minutes), approvedAt: ago(minutes),
  summaryJa: `見出し${id}`, summaryEn: `Headline ${id}`, impactJa: `${SECRET}${id}`, impactEn: `${SECRET}${id}`, impactLabel: "positive", confidence: "high" });
const official = (id, minutes) => ({ id, title: `Official ${id}`, translationJa: `公式${id}`, url: `https://example.com/o/${id}`, publisher: "Issuer", tickers: ["NVDA"], observedAt: ago(minutes), publishedAt: ago(minutes), bodyJa: SECRET, bodyEn: SECRET });
const wireItem = (id, minutes, titleEn) => ({ id, titleEn, titleJa: `ワイヤー${id}`, shortJa: null, publisher: "Wire", origin: "wire", url: `https://example.com/w/${id}`, publishedAt: ago(minutes) });
const feed = { ok: true, enabled: true, items: [item("1", 5), item("2", 40), item("3", 50), item("4", 60), item("5", 70), item("6", 80), item("7", 90)],
  officialUpdates: [official("a", 1), official("b", 35)], analystUpdates: [], marketUpdates: [] };
const wire = { ok: true, items: { MU: [{ ...wireItem("w1", 3, "Micron opens new memory plant in Idaho") }, wireItem("w2", 45, "Samsung wins HBM supply deal with Nvidia")] } };

let loader, dir;
test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "first-news-"));
  const stubs = { name: "stubs", setup(b) {
    b.onResolve({ filter: /^server-only$|^next\/headers$|^@\/lib\/membership\/server$|\/tech-news-server$|\/public-news-response$/ }, args => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents:
      args.path === "server-only" ? "" :
      args.path === "next/headers" ? "export const cookies = async () => ({ getAll: () => globalThis.__first.cookies });" :
      args.path.endsWith("membership/server") ? "export const getMembership = async () => { const m = globalThis.__first.member; if (m instanceof Error) throw m; return m; };" :
      args.path.endsWith("public-news-response") ? "export const buildPublicNews = raw => structuredClone(raw);" :
      "export async function readMonitor(path) { globalThis.__first.reads.push(path); return structuredClone(path === 'news' ? globalThis.__first.feed : globalThis.__first.wire); }" }));
  } };
  const out = join(dir, "loader.mjs");
  await build({ entryPoints: [new URL("../lib/research/news-first-paint.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, plugins: [stubs], logLevel: "silent",
    alias: { "@": new URL("..", import.meta.url).pathname.replace(/\/$/, "") } });
  loader = await import(pathToFileURL(out).href);
});
test.after(() => rm(dir, { recursive: true, force: true }));

async function firstFor(t, { cookies, member }) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  globalThis.__first = { cookies, member, feed, wire, reads: [] };
  return loader.loadFirstNews();
}
const signedIn = [{ name: "__client_uat", value: "1763000000" }];
const ids = first => [...first.feed.items.filter(x => x.tickers?.length), ...first.feed.officialUpdates].map(x => x.id).sort();

for (const [label, cookies] of [["no cookie at all", []], ["the SDK's signed-out mark", [{ name: "__client_uat", value: "0" }]]]) {
  test(`signed-out visitor (${label}): FREE projection only, never the membership lookup`, async t => {
    const first = await firstFor(t, { cookies, member: new Error("must not be asked") });
    assert.ok(!("full" in first));
    const json = JSON.stringify(first);
    assert.ok(!json.includes(SECRET), "no paid text");
    // 30 minutes behind: nothing newer than 30 minutes; the latest five at most.
    assert.ok(!ids(first).includes("1") && !ids(first).includes("a"));
    assert.ok(ids(first).length <= 5);
    assert.ok(Object.values(first.wire).flat().every(x => Date.parse(x.publishedAt) <= NOW - 30 * 60_000));
  });
}

test("any browser with a session gets nothing drawn, and nobody's membership is looked up (no PRO first paint exists)", async t => {
  for (const cookies of [signedIn, [{ name: "__session", value: "eyJ" }], [{ name: "__client_uat_AbC", value: "1763000000" }]]) {
    assert.equal(await firstFor(t, { cookies, member: new Error("must not be asked") }), null, JSON.stringify(cookies));
    assert.deepEqual(globalThis.__first.reads, [], "and the monitor is not read for it");
    t.mock.timers.reset();
  }
  assert.doesNotMatch(read("lib/research/news-first-paint.ts"), /getMembership|isFullAccess|full:/);
  assert.doesNotMatch(read("app/research/news/flash-page.tsx"), /initial\?\.full|full: boolean/);
});

test("nothing member-only can be kept by a shared cache: the pages are rendered per request and verify the session", () => {
  for (const page of ["app/research/news/page.tsx", "app/research/general-news/page.tsx"]) {
    const source = read(page);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.doesNotMatch(source, /revalidate|"force-static"|unstable_cache|Cache-Control/);
  }
  // Owner, Oct 21: public pages open without the identity proxy (no session handshake on a cold open). A signed-in browser therefore cannot
  // be verified here and gets nothing drawn; members see their own last view from this device instead (lib/research/member-last-view.ts).
  const matcher = read("proxy.ts").match(/"\/research\/\(\(\?!\(\?:([^)]*)\)/)[1].split("|");
  assert.ok(matcher.includes("news") && matcher.includes("general-news"), matcher.join("|"));
  assert.doesNotMatch(read("lib/research/news-first-paint.ts"), /unstable_cache|"use cache"/);
});
