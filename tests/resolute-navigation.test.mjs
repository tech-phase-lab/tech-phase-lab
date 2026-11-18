import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { forget, lastViewSession, recall, remember, viewSession } from "../lib/resolute/view-memory.ts";
import { requestPlan } from "../lib/resolute/plan-client.ts";
import { createReviewSamplePlan } from "../lib/resolute/review-sample.ts";
import { requestPreferences } from "../lib/resolute/preferences-client.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const inBrowser = async run => {
  const had = "window" in globalThis;
  globalThis.window = globalThis.window ?? {};
  try { forget(); await run(); } finally { forget(); if (!had) delete globalThis.window; }
};

test("RESOLUTE view memory never holds anything on the server", () => {
  assert.equal("window" in globalThis, false);
  remember("plan", { plan: null, revision: 1 });
  assert.equal(recall("plan"), undefined);
  viewSession("sess_a");
  assert.equal(lastViewSession(), undefined);
});

test("RESOLUTE view memory is forgotten when a different sign-in or a sign-out is seen", async () => {
  await inBrowser(() => {
    viewSession("sess_a");
    remember("plan", { plan: null, revision: 1 });
    remember("entitlement", { canUseTools: true });
    viewSession("sess_a");
    assert.deepEqual(recall("plan"), { plan: null, revision: 1 });
    assert.equal(lastViewSession(), "sess_a");
    viewSession("sess_b");
    assert.equal(recall("plan"), undefined);
    assert.equal(recall("entitlement"), undefined);
    remember("locale", "en");
    viewSession(null);
    assert.equal(recall("locale"), undefined);
    assert.equal(lastViewSession(), null);
  });
});

test("a loaded saved plan is remembered for the next page, and forgotten when access is refused", async () => {
  await inBrowser(async () => {
    const plan = { ...createReviewSamplePlan(), createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z" };
    const ok = async () => new Response(JSON.stringify({ plan, revision: 3 }), { status: 200, headers: { "content-type": "application/json" } });
    const snapshot = await requestPlan(undefined, undefined, ok);
    assert.equal(recall("plan"), snapshot);
    assert.equal(recall("plan").revision, 3);
    await assert.rejects(requestPlan(undefined, undefined, async () => new Response("", { status: 401 })));
    assert.equal(recall("plan"), undefined);
  });
});

test("a language saved in settings is the one the next RESOLUTE page opens in", async () => {
  await inBrowser(async () => {
    remember("locale", "ja");
    const saved = async () => new Response(JSON.stringify({ locale: "en", timezone: "America/New_York", configured: true }), { status: 200, headers: { "content-type": "application/json" } });
    await requestPreferences({ locale: "en", timezone: "America/New_York" }, undefined, saved);
    assert.equal(recall("locale"), "en");
  });
});

test("every RESOLUTE page except the home has a prefetched way back to the home, with a large tap area", async () => {
  const link = await read("../app/resolute/home-link.tsx");
  assert.match(link, /href="\/resolute" prefetch /);
  assert.match(link, /data-resolute-home/);
  assert.match(link, /en \? "Home" : "ホーム"/);
  const css = await read("../app/resolute/tool-shell.module.css");
  assert.match(css, /\.home \{[^}]*min-height: 44px/);
  const shell = await read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /\{home \? null : <HomeLink en=\{en\} \/>\}/);
  // The brand still goes home too.
  assert.match(shell, /<Link href="\/resolute" className=\{h\.brand\} prefetch>RESOLUTE<\/Link>/);
  // Settings is reached from the RESOLUTE menu, so it leads back as well.
  assert.match(await read("../app/resolute/settings/screen.tsx"), /<HomeLink en=\{viewLocale === "en"\} \/>/);
});

test("moving between RESOLUTE pages draws the page once with what the tab already knows", async () => {
  const shell = await read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /useState<Access>\(\(\)=>recall\("entitlement"\)\?"allowed":"loading"\)/);
  assert.match(shell, /recall<DiagnosisLocale>\("locale"\)/);
  assert.match(shell, /const shown=reviewing \? identityReady : access==="allowed";/);
  assert.match(shell, /\{shown \? children\(/);
  // A refusal or failed check forgets the remembered access.
  assert.match(shell, /r\.status===401\) \{if\(!retryLater\(\)\) \{forget\(\);setAccess\("signed-out"\);\}/);
  assert.match(shell, /if\(value\.canUseTools\) remember\("entitlement",value\); else forget\("entitlement"\);/);
  const identity = await read("../app/resolute/identity.tsx");
  assert.match(identity, /if\(isLoaded\) viewSession\(loadedSession \?\? null\);/);
  assert.match(identity, /const sessionId=isLoaded \? loadedSession : known;/);
  const remembered = await read("../app/resolute/features/use-remembered.ts");
  assert.match(remembered, /review \? undefined : recall<T>\(key\)/);
  assert.match(await read("../app/resolute/features/use-plan.tsx"), /useRemembered<PlanSnapshot>\('plan'\)/);
  assert.match(await read("../app/resolute/features/use-risk.tsx"), /reviewing\?null:recall<RiskFeed>\('risk'\)/);
  for (const screen of ["notebook/screen.tsx", "simulation/screen.tsx", "../resolute/notifications-screen.tsx", "home/screen.tsx"])
    assert.match(await read(`../app/resolute/${screen}`), /useRemembered</);
});

test("the menu stays up until the next page replaces it, with a pending mark on the tapped item", async () => {
  const shell = await read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /const leave=\(href:string\)=>reviewing \|\| current===href \? close : undefined;/);
  assert.doesNotMatch(shell, /onClick=\{close\}/);
  assert.match(shell, /useLinkStatus\(\)/);
  assert.equal((shell.match(/<Pending \/>/g) ?? []).length, 2);
});

test("the owner keeps full RESOLUTE access when the page is drawn from memory", async () => {
  const shell = await read("../app/resolute/tool-shell.tsx");
  // Owner access arrives through the same entitlement answer (accessBasis owner, canUseTools true) and is remembered like any other.
  assert.match(shell, /remember\("entitlement",value\)/);
  assert.doesNotMatch(shell, /accessBasis[^\n]*forget/);
});
