import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");

// --- 1. The disclaimer never shows on a loading screen (owner, Nov 18: it sat under the ハイテク速報 loader in large grey text).

test("the shared research loader has no footer, so no disclaimer under 「読み込み中…」", () => {
  const loading = read("../app/research/loading.tsx");
  assert.match(loading, /<ResearchToolShell [^>]*footer=\{false\}>/);
  const shell = read("../app/research/research-tool-shell.tsx");
  assert.match(shell, /footer = true \}/);
  assert.match(shell, /\{footer && <footer><Disclaimer en=\{lang === "en"\} \/><\/footer>\}/);
  // The alerts page, the watchlist and stock search all use this loader while they load.
  assert.match(read("../app/research/news/page.tsx"), /\{!ready && <ResearchLoading \/>\}/);
});

test("RESOLUTE's 「確認中…」 screen has no disclaimer; real content, the access message and the owner preview keep it as the last line", () => {
  const shell = read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /const shown=reviewing \? identityReady : access==="allowed";/);
  assert.match(shell, /const checking=!shown && \(!identityReady \|\| access==="loading"\);/);
  assert.match(shell, /\{shown \? children\(/);
  assert.match(shell, /: checking \? <section className=\{styles\.loadingBrand\}/);
  assert.match(shell, /\{checking \? null : <Disclaimer en=\{en\} \/>\}\n <\/div><\/main>;/);
});

test("the disclaimer is small and faint everywhere, and the sentence itself is unchanged", async () => {
  const { DISCLAIMER } = await import("../lib/legal/disclaimer.ts");
  assert.equal(DISCLAIMER.ja, "本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。");
  const component = read("../app/resolute/disclaimer.tsx");
  assert.match(component, /fontSize: 10, lineHeight: 1\.6, color: "currentColor", opacity: 0\.4/);
  assert.doesNotMatch(component, /margin: "(?:1[6-9]|[2-9]\d)px/);
  // The alert page a notification opens draws the same sentence with its own class: the same small size.
  assert.match(read("../app/resolute/alerts/latest/latest.module.css"), /\.disc \{ margin:12px 0 0; font-size:10px;/);
  // LP footers end with it.
  assert.match(read("../app/resolute/lp/landing.tsx"), /<p>画面はイメージです。<\/p>\n    <Disclaimer \/>\n   <\/footer>/);
  assert.match(read("../app/resolute/lp/landing-en.tsx"), /<p>Screens shown are for illustrative purposes only\.<\/p>\n    <Disclaimer en \/>\n   <\/footer>/);
});

// --- 1b. The alerts page waits for its two API answers behind the loader: their membership check and monitor reads run together.

test("the alert APIs start the membership check (and FREE's second monitor read) alongside their main read", () => {
  const news = read("../app/api/research/news/route.ts");
  const fullAt = news.indexOf("const fullAccess = viewerHasFullNews();");
  assert.ok(fullAt > 0 && fullAt < news.indexOf("await fetch(url"), "news: membership starts before the monitor read");
  assert.match(news, /fullAccess\.then\(full => full \? null : readMonitor\("company-wire", 400_000, 2_500\)\.then\(raw => parseCompanyWire\(raw\)\.items\)\.catch\(\(\) => null\)\)/);
  assert.match(news, /const full = await fullAccess;/);
  const wire = read("../app/api/research/company-wire/route.ts");
  const wireAt = wire.indexOf("const fullAccess = viewerHasFullNews();");
  assert.ok(wireAt > 0 && wireAt < wire.indexOf("await fetch(url"), "wire: membership starts before the monitor read");
  assert.match(wire, /fullAccess\.then\(full => full \? null : readMonitor\("news", 500_000, 5_000\)\.then\(raw => \(\{ feed: buildPublicNews\(raw\) \}\)\)\.catch\(\(\) => null\)\)/);
  // FREE without the news feed still sends nothing rather than everything.
  assert.match(wire, /if \(!read\) throw new Error\("News unavailable"\);/);
});

// --- 2. The remembered owner/PRO header survives a passing signed-out answer, so the next cold start paints it at once.

const compiled = ts.transpileModule(read("../app/research/member-display-provider.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
async function harness(t, results, stored = null) {
  const states = [], timers = [], events = new Map(), storage = new Map(); let effect, calls = 0;
  if (stored) storage.set("tech-phase:member-hint", JSON.stringify(stored));
  t.mock.method(globalThis, "setTimeout", (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => { if (timer) timer.cancelled = true; });
  t.mock.method(globalThis, "setInterval", () => 0); t.mock.method(globalThis, "clearInterval", () => {});
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  globalThis.window = { localStorage, addEventListener: (k, v) => events.set(k, v), removeEventListener: k => events.delete(k) };
  const root = { dataset: {} };
  globalThis.document = { visibilityState: "visible", documentElement: root, addEventListener: (k, v) => events.set(k, v), removeEventListener: k => events.delete(k) };
  const react = { ...require("react"), useState: value => { const index = states.length; states.push(value); return [value, next => { states[index] = next; }]; }, useEffect: fn => { effect = fn; } };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(id => {
    if (id === "react") return react;
    if (id === "./identity-provider") return { useIdentityRefresh: () => async () => {} };
    if (id === "@/lib/research/member-recovery") return { recoverMember: async () => { const result = results[Math.min(calls++, results.length - 1)]; if (result instanceof Error) throw result; return result; } };
    return require(id);
  }, mod, mod.exports);
  mod.exports.MemberDisplayProvider({ children: null }); const cleanup = effect();
  t.after(() => { cleanup(); globalThis.window = previousWindow; globalThis.document = previousDocument; });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  await flush();
  const runRetry = async () => { const timer = timers.find(x => x.ms === 2000 && !x.cancelled && !x.ran); assert.ok(timer, "a retry is scheduled"); timer.ran = true; timer.fn(); await flush(); };
  // The app comes back from the background a while later (a resume re-check is skipped within a second of the last one).
  const resume = async () => { const now = Date.now(); t.mock.method(Date, "now", () => now + 5_000); events.get("focus")(); await flush(); };
  return { states, events, storage, root, flush, runRetry, resume, hint: () => storage.get("tech-phase:member-hint"), calls: () => calls, mod };
}
const ownerAnswer = { response: { ok: true }, member: { status: "signed-in", plan: "pro", accessExpiresAt: Date.now() + 3_600_000, isAdmin: true, ownerMode: true, ownerAccount: true } };
const signedOut = { response: { ok: true }, member: { status: "signed-out", plan: "free" } };
// states: 0 plan, 1 owner, 2 ownerMode, 3 ownerAccount, 4 settled

test("a verified owner answer writes the hint and the pre-paint attribute", async t => {
  const h = await harness(t, [ownerAnswer]);
  assert.equal(h.states[3], true); assert.equal(h.states[0], "pro");
  assert.equal(JSON.parse(h.hint()).ownerAccount, true);
  assert.equal(h.root.dataset.memberHint, "owner");
});

test("one signed-out answer after resuming from the background keeps the owner header and its hint (it used to clear them)", async t => {
  const h = await harness(t, [ownerAnswer, signedOut, ownerAnswer]);
  await h.resume();
  assert.equal(h.calls(), 2);
  assert.ok(h.hint(), "the remembered owner state is still there for the next cold start");
  assert.equal(h.states[3], true); assert.equal(h.states[0], "pro");
  assert.equal(h.root.dataset.memberHint, "owner");
  await h.runRetry();
  assert.equal(h.calls(), 3); assert.equal(h.states[3], true); assert.ok(h.hint());
});

test("three signed-out answers in a row (a real sign-out) still clear the header and the hint", async t => {
  const h = await harness(t, [ownerAnswer, signedOut]);
  await h.resume();
  await h.runRetry(); await h.runRetry();
  assert.equal(h.calls(), 4);
  assert.equal(h.hint(), undefined); assert.equal(h.states[3], false); assert.equal(h.states[0], null);
  assert.equal(h.root.dataset.memberHint, undefined);
});

test("coming back online re-checks without blanking the remembered owner header", async t => {
  const h = await harness(t, [new Error("identity-loading")], { plan: "pro", owner: true, ownerMode: true, ownerAccount: true, accessExpiresAt: Date.now() + 86_400_000 });
  assert.equal(h.states[3], true); assert.equal(h.states[4], true);
  h.events.get("online")(); await h.flush();
  assert.equal(h.states[3], true); assert.equal(h.states[0], "pro"); assert.ok(h.hint());
});

test("a remembered state restores the pre-paint attribute if <html> lost it", async t => {
  const h = await harness(t, [new Error("identity-loading")], { plan: "free", owner: true, ownerMode: true, ownerAccount: true, accessExpiresAt: Date.now() + 86_400_000 });
  assert.equal(h.root.dataset.memberHint, "owner");
});

test("a verified FREE answer clears the hint and the gold pre-paint attribute", async t => {
  const free = { response: { ok: true }, member: { status: "signed-in", plan: "free", accessExpiresAt: 0, isAdmin: false, ownerAccount: false } };
  const h = await harness(t, [free], { plan: "pro", owner: false, ownerMode: false, ownerAccount: false, accessExpiresAt: Date.now() + 86_400_000 });
  assert.equal(h.hint(), undefined); assert.equal(h.root.dataset.memberHint, undefined); assert.equal(h.states[0], "free");
});

test("the owner account keeps its owner hint even when its plan reads FREE (owner access, Nov 13)", async t => {
  const free = { response: { ok: true }, member: { status: "signed-in", plan: "free", accessExpiresAt: 0, isAdmin: false, ownerAccount: false } };
  const o = await harness(t, [{ response: { ok: true }, member: { ...free.member, ownerAccount: true } }]);
  assert.equal(JSON.parse(o.hint()).ownerAccount, true); assert.equal(o.root.dataset.memberHint, "owner"); assert.equal(o.states[3], true);
});

test("logging out forgets the remembered owner/PRO header on this device", () => {
  const view = read("../app/research/account/account-view.tsx");
  assert.match(view, /import \{ forgetMemberHint \} from "\.\.\/member-display-provider";/);
  assert.match(view, /if \(clerk\.loaded\) \{ forgetMemberHint\(\); void clerk\.signOut\(\{ redirectUrl: "\/research" \}\); \}/);
});
