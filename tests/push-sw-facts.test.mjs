import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { askWorkerVersion, isPushRegistration, pushSwFactRows, readPushSwFacts, refreshPushWorker, reinstallMessage, reinstallPushWorker,
  PUSH_SW_OPTIONS } from "../lib/research/push-sw-facts.ts";

const ORIGIN = "https://techphase.app";
const immediate = (fn, ms) => setTimeout(fn, Math.min(ms, 50));

// A worker that answers the version question (version set) or stays silent like one from before Nov 16 (version null).
function worker(script, version, { lastPush = null, state = "activated" } = {}) {
  const w = { scriptURL: `${ORIGIN}${script}`, state, listeners: new Set(),
    addEventListener: (_name, fn) => w.listeners.add(fn), removeEventListener: (_name, fn) => w.listeners.delete(fn),
    become: next => { w.state = next; for (const fn of [...w.listeners]) fn(); },
    postMessage: (message, ports) => {
      assert.deepEqual(message, { type: "version-query" });
      if (version) queueMicrotask(() => ports[0].postMessage({ type: "version", version, lastPush }));
    } };
  return w;
}

test("a worker's version is asked over a port; a worker that does not answer counts as old", async () => {
  assert.deepEqual(await askWorkerVersion(worker("/research-sw.js", "2026-11-16-version-query", { lastPush: 123 }), { timeout: immediate }),
    { version: "2026-11-16-version-query", lastPush: 123 });
  assert.equal(await askWorkerVersion(worker("/research-sw.js", null), { timeout: immediate }), null);
  assert.equal(await askWorkerVersion({ postMessage: () => { throw new Error("gone"); } }, { timeout: immediate }), null);
});

function container({ registration, controller = null, registrations = registration ? [registration] : [] } = {}) {
  return { controller, getRegistration: async scope => { assert.equal(scope, "/research"); return registration; }, getRegistrations: async () => registrations };
}
const store = record => ({ open: async name => { assert.equal(name, "tech-phase-push-open");
  return { match: async key => key === `${ORIGIN}/research-sw/diagnostic` && record ? { json: async () => record } : undefined }; } });

test("the owner's panel reads the installed workers, their versions, permission, display mode and the last push", async () => {
  const active = worker("/research-sw.js", null);
  const waiting = worker("/research-sw.js", "2026-11-16-version-query", { state: "installed" });
  const registration = { scope: `${ORIGIN}/`, updateViaCache: "imports", active, waiting, installing: null };
  const facts = await readPushSwFacts({ container: container({ registration, controller: active }), caches: store({ push: 1_800_000_000_000 }),
    origin: ORIGIN, permission: "granted", standalone: true, ask: w => askWorkerVersion(w, { timeout: immediate }) });
  assert.deepEqual(facts, { supported: true, controlled: true, controllerScript: "/research-sw.js", scope: "/", updateViaCache: "imports", registrations: 1,
    workers: [{ slot: "active", script: "/research-sw.js", version: null }, { slot: "waiting", script: "/research-sw.js", version: "2026-11-16-version-query" }],
    permission: "granted", standalone: true, lastPush: 1_800_000_000_000 });
  const rows = Object.fromEntries(pushSwFactRows(facts, "ja").map(row => [row.label, row.value]));
  assert.equal(rows["このページをワーカーが管理"], "はい · /research-sw.js");
  assert.equal(rows["動作中のワーカー"], "/research-sw.js · 古い版（応答なし）");
  assert.equal(rows["待機中のワーカー"], "/research-sw.js · 2026-11-16-version-query");
  assert.equal(rows["インストール中のワーカー"], "なし");
  assert.equal(rows["更新の取得方法"], "imports");
  assert.equal(rows["通知の許可"], "許可");
  assert.equal(rows["ホーム画面のアプリとして起動"], "はい");
  assert.notEqual(rows["ワーカーが最後に通知を受信"], "記録なし");
  // The active worker's own answer wins over the stored record.
  const fresh = { scope: `${ORIGIN}/`, updateViaCache: "none", active: worker("/research-sw.js", "v2", { lastPush: 1_800_000_100_000 }) };
  const answered = await readPushSwFacts({ container: container({ registration: fresh }), caches: store({ push: 1 }), origin: ORIGIN,
    permission: "default", standalone: false, ask: w => askWorkerVersion(w, { timeout: immediate }) });
  assert.equal(answered.lastPush, 1_800_000_100_000); assert.equal(answered.controlled, false);
  const en = Object.fromEntries(pushSwFactRows(answered, "en").map(row => [row.label, row.value]));
  assert.equal(en["Active worker"], "/research-sw.js · v2"); assert.equal(en["Notification permission"], "not asked");
  assert.equal(en["Page controlled by a worker"], "no");
  // Nothing installed, and a browser without service workers.
  const none = await readPushSwFacts({ container: container(), caches: store(null), origin: ORIGIN, permission: "denied", standalone: null });
  const noneRows = Object.fromEntries(pushSwFactRows(none, "ja").map(row => [row.label, row.value]));
  assert.equal(noneRows["登録の範囲"], "登録なし"); assert.equal(noneRows["ワーカーが最後に通知を受信"], "記録なし"); assert.equal(noneRows["通知の許可"], "拒否");
  const unsupported = await readPushSwFacts({ container: undefined, caches: undefined, origin: ORIGIN, permission: "unsupported", standalone: null });
  assert.deepEqual(pushSwFactRows(unsupported, "ja"), [{ label: "サービスワーカー", value: "このブラウザでは使えません" }]);
});

test("only the push worker's registrations are taken for reinstalling", () => {
  assert.equal(isPushRegistration({ scope: `${ORIGIN}/` }, ORIGIN), true);
  assert.equal(isPushRegistration({ scope: `${ORIGIN}/research/` }, ORIGIN), true);
  assert.equal(isPushRegistration({ scope: `${ORIGIN}/resolute/`, active: worker("/other-sw.js", null) }, ORIGIN), false);
  assert.equal(isPushRegistration({ scope: `${ORIGIN}/elsewhere/`, active: worker("/research-sw.js?v=1", null) }, ORIGIN), true);
});

test("「通知の仕組みを入れ直す」 unregisters, registers with updateViaCache none, waits for activation and saves the device again", async () => {
  const log = [];
  const previous = { endpoint: "https://push.example/old" };
  const old = { scope: `${ORIGIN}/`, active: worker("/research-sw.js", null), pushManager: { getSubscription: async () => previous },
    unregister: async () => { log.push("unregister /"); return true; } };
  const other = { scope: `${ORIGIN}/resolute/`, active: worker("/other-sw.js", null), unregister: async () => { log.push("unregister other"); return true; } };
  const installing = worker("/research-sw.js", "v2", { state: "installing" });
  const fresh = { scope: `${ORIGIN}/`, updateViaCache: "none", active: null, installing, waiting: null };
  const c = { getRegistration: async () => old, getRegistrations: async () => [old, other],
    register: async (url, options) => { log.push(["register", url, options]); setTimeout(() => installing.become("activated"), 5); return fresh; } };
  const result = await reinstallPushWorker({ container: c, origin: ORIGIN, timeout: immediate,
    resubscribe: async (registration, before) => { log.push(["resubscribe", registration === fresh, before]); return { registered: true, keptPreferences: true }; } });
  assert.deepEqual(log, ["unregister /", ["register", "/research-sw.js", { scope: "/", updateViaCache: "none" }], ["resubscribe", true, previous]]);
  assert.deepEqual(result, { ok: true, removed: 1, hadSubscription: true, registered: true, keptPreferences: true, updateViaCache: "none" });
  assert.match(reinstallMessage(result, "ja"), /^入れ直しました。テスト通知で確かめてください。（古い登録 1 件を削除、通知の登録を保存、届く内容の設定を引き継ぎ）$/);
});

test("a reinstall that cannot finish says which step failed", async () => {
  const stuck = worker("/research-sw.js", null, { state: "installing" });
  const base = { getRegistration: async () => undefined, getRegistrations: async () => [] };
  const timedOut = await reinstallPushWorker({ container: { ...base, register: async () => ({ scope: `${ORIGIN}/`, installing: stuck }) }, origin: ORIGIN,
    timeout: immediate, ms: 1, resubscribe: async () => assert.fail("not reached") });
  assert.equal(timedOut.ok, false); assert.equal(timedOut.failedAt, "activate"); assert.equal(timedOut.hadSubscription, false);
  assert.match(reinstallMessage(timedOut, "ja"), /^入れ直しに失敗しました。.*（ワーカーの起動）$/);
  const refused = await reinstallPushWorker({ container: { ...base, register: async () => { throw new Error("SecurityError"); } }, origin: ORIGIN,
    resubscribe: async () => assert.fail("not reached") });
  assert.equal(refused.failedAt, "register");
  const unsaved = await reinstallPushWorker({ container: { ...base, register: async () => ({ scope: `${ORIGIN}/`, active: worker("/research-sw.js", "v2") }) },
    origin: ORIGIN, resubscribe: async () => ({ registered: false }) });
  assert.deepEqual([unsaved.ok, unsaved.failedAt], [false, "subscribe"]);
  const thrown = await reinstallPushWorker({ container: { ...base, register: async () => ({ scope: `${ORIGIN}/`, active: worker("/research-sw.js", "v2") }) },
    origin: ORIGIN, resubscribe: async () => { throw new Error("pro-required"); } });
  assert.equal(thrown.failedAt, "subscribe");
  assert.match(reinstallMessage(thrown, "en"), /^Reinstall failed \(saving this device\)/);
});

test("the app's check for a new worker moves an older registration onto updateViaCache none", async () => {
  const calls = [];
  const old = { scope: `${ORIGIN}/`, updateViaCache: "imports", update: async () => calls.push("update") };
  assert.equal(await refreshPushWorker({ getRegistration: async () => old, register: async (url, options) => { calls.push([url, options]); return old; } }), "re-registered");
  assert.deepEqual(calls, [["/research-sw.js", PUSH_SW_OPTIONS]]);
  const current = { scope: `${ORIGIN}/`, updateViaCache: "none", update: async () => calls.push("update") };
  assert.equal(await refreshPushWorker({ getRegistration: async () => current, register: async () => assert.fail("not registered again") }), "updated");
  assert.deepEqual(calls.at(-1), "update");
  // A device that never turned notifications on gets no worker.
  assert.equal(await refreshPushWorker({ getRegistration: async () => undefined, register: async () => assert.fail("never installed here") }), "none");
});

test("the settings page registers the worker with updateViaCache none and gives the owner's panel the reinstall button", () => {
  const settings = fs.readFileSync(new URL("../app/research/notification-settings.tsx", import.meta.url), "utf8");
  assert.match(settings, /navigator\.serviceWorker\.register\(PUSH_SW_URL, PUSH_SW_OPTIONS\)/);
  assert.doesNotMatch(settings, /register\("\/research-sw\.js"/);
  assert.match(settings, /ownerAccount \? <PushDiagnosticPanel lang=\{lang\} onReinstall=\{key \? reinstall : undefined\} \/> : null/);
  // The device is saved again through the existing actions, and the old device's choices are carried over before it is removed.
  for (const action of ["preferences", "register", "save-preferences", "remove"]) assert.match(settings, new RegExp(`request\\("${action}"`));
  assert.deepEqual(PUSH_SW_OPTIONS, { scope: "/", updateViaCache: "none" });
});
