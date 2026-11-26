// Speed, Nov 26: ハイテク速報 and 注目トピック draw the FREE view into the first HTML for every reader (lib/research/news-first-paint.ts): the
// projection a visitor or a FREE member gets (30 minutes behind, the latest five, headlines only), never anything member-only. Signed-out
// visitors and FREE members see it at once; a browser remembering PRO hides it by CSS before the first paint and reads its own feed.
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

for (const [label, cookies] of [["a visitor", []], ["the SDK's signed-out mark", [{ name: "__client_uat", value: "0" }]], ["a signed-in FREE member", signedIn], ["a signed-in PRO member", signedIn]]) {
  test(`${label}: the same FREE projection, and nobody's membership is looked up`, async t => {
    const first = await firstFor(t, { cookies, member: new Error("must not be asked") });
    const json = JSON.stringify(first);
    assert.ok(!json.includes(SECRET), "no paid text");
    // 30 minutes behind, the newest five across sources, headlines only.
    assert.deepEqual(ids(first), ["2", "3", "4", "b"]);
    assert.deepEqual(Object.values(first.wire).flat().map(x => x.id), ["w2"]);
    assert.ok(Object.values(first.wire).flat().every(x => Date.parse(x.publishedAt) <= NOW - 30 * 60_000));
  });
}
test("the loader reads no session and no membership", () => {
  assert.doesNotMatch(read("lib/research/news-first-paint.ts"), /getMembership|isFullAccess|cookies\(|full:/);
  assert.doesNotMatch(read("app/research/news/flash-page.tsx"), /initial\?\.full|full: boolean/);
});

test("under a remembered PRO / owner mark the FREE view is hidden before the first paint and the page reads its own feed at once", () => {
  assert.match(read("app/research/news/flash-page.module.css"), /:global\(html\[data-member-hint\]\) \.flash\[data-free-first\]\{visibility:hidden\}/);
  assert.match(read("app/research/news/general-news.module.css"), /:global\(html\[data-member-hint\]\) \.topics\[data-free-first\]\{visibility:hidden\}/);
  const flash = read("app/research/news/flash-page.tsx");
  assert.match(flash, /data-free-first=\{serverFirst \? "" : undefined\}/);
  assert.match(flash, /setFeed\(payload\); setFailed\(false\); setCheckedAt\(Date\.now\(\)\); setServerFirst\(false\);/);
  assert.match(flash, /poller\.start\(drawnFree \? NEWS_POLL_INTERVAL_MS : 0\)/);
  const topics = read("app/research/news/general-news-panel.tsx");
  assert.match(topics, /<TopicsList serverFirst=\{useSeed\}/);
  assert.match(topics, /if \(generalOnly && initialNews && memberMarked\(\)\) setRefresh\(value => value \|\| 1\);/);
  // The mark is set before the first paint from the remembered membership.
  assert.match(read("app/research/layout.tsx"), /<script dangerouslySetInnerHTML=\{\{ __html: memberHintBoot \}\} \/>/);
});

test("the pages are rendered per request and stay outside the identity proxy", () => {
  for (const page of ["app/research/news/page.tsx", "app/research/general-news/page.tsx"]) {
    const source = read(page);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.doesNotMatch(source, /revalidate|"force-static"|unstable_cache|Cache-Control/);
  }
  // Owner, Oct 21: public pages open without the identity proxy (no session handshake on a cold open); the FREE view needs no membership.
  const matcher = read("proxy.ts").match(/"\/research\/\(\(\?!\(\?:([^)]*)\)/)[1].split("|");
  assert.ok(matcher.includes("news") && matcher.includes("general-news"), matcher.join("|"));
  assert.doesNotMatch(read("lib/research/news-first-paint.ts"), /unstable_cache|"use cache"/);
});
