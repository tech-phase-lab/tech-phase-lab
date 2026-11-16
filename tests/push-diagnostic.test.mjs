import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import ts from "typescript";
import { cleanPushDiagnostic, createPushDiagnosticLimiter, createPushDiagnostics, pushDiagnosticLine, pushDiagnosticRows, pushDiagnosticSignature,
  readPushDiagnostic, recentPushDiagnostic, PUSH_DIAG_STORAGE_KEY } from "../lib/research/push-diagnostic.ts";
import { pushSwFactRows, readPushSwFacts, reinstallMessage } from "../lib/research/push-sw-facts.ts";

const require = createRequire(import.meta.url);
const NOW = Date.now();
function memory(initial) {
  const map = new Map(initial ? [[PUSH_DIAG_STORAGE_KEY, JSON.stringify(initial)]] : []);
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

test("a record keeps only known steps with the right kind of value: no title, page, member or free text", () => {
  const clean = cleanPushDiagnostic({ v: "2026-11-15-inapp-banner", id: "n-1", push: NOW, shown: NOW + 1, listed: true, listApi: false, stillListed: null,
    via: "banner", title: "secret", url: "/research/news", endpoint: "https://push.example", userId: "user_1", click: "soon", query: 1.5, banner: 12,
    controlled: "yes" });
  assert.deepEqual(clean, { v: "2026-11-15-inapp-banner", id: "n-1", push: NOW, shown: NOW + 1, listed: true, listApi: false, stillListed: null, via: "banner" });
  for (const bad of [null, "x", { id: "<x>" }, { id: "a".repeat(65) }, {}]) assert.equal(cleanPushDiagnostic(bad), null);
  assert.equal(cleanPushDiagnostic({ id: "n", v: "<script>" }).v, "unknown");
  assert.equal(cleanPushDiagnostic({ id: "n", via: "elsewhere" }).via, undefined);
});

test("the log line reads as seconds after the push, in a fixed order", () => {
  const at = Date.UTC(2026, 10, 15, 3, 0, 0);
  assert.equal(pushDiagnosticLine({ v: "x", id: "n-1", push: at, shown: at + 300, foreground: at + 20_000, queryTimeout: at + 21_000, listApi: true, listed: false, stillListed: null }),
    "v=x id=n-1 at=2026-11-15T03:00:00.000Z push=+0.0s shown=+0.3s foreground=+20.0s queryTimeout=+21.0s listApi=yes listed=no stillListed=unknown");
  assert.equal(pushDiagnosticLine({ v: "x", id: "n-2", click: at }), "v=x id=n-2 at=2026-11-15T03:00:00.000Z click=+0.0s");
});

test("the app merges the worker's record with its own steps; a newer notice starts again, an older one read late does not", () => {
  const storage = memory();
  const changes = [];
  const d = createPushDiagnostics({ storage, changed: record => changes.push(record) });
  d.fromWorker({ v: "w1", id: "n-1", push: NOW - 5000, shown: NOW - 4900, listApi: true, listed: true });
  d.note({ foreground: NOW - 100, controlled: true, standalone: true });
  d.note({ query: NOW - 90 });
  d.note({ query: NOW - 10 });
  d.note({ banner: NOW - 80 }, "n-1");
  d.fromWorker({ v: "w1", id: "n-1", push: NOW - 5000, shown: NOW - 4900, listApi: true, listed: true, click: NOW - 50 });
  assert.deepEqual(d.current(), { v: "w1", id: "n-1", push: NOW - 5000, shown: NOW - 4900, click: NOW - 50, foreground: NOW - 100, query: NOW - 90,
    banner: NOW - 80, listApi: true, listed: true, controlled: true, standalone: true });
  assert.deepEqual(readPushDiagnostic(storage), d.current(), "kept on the device for the owner's settings page");
  d.fromWorker({ v: "w1", id: "n-0", push: NOW - 9000 });
  assert.equal(d.current().id, "n-1", "an older notice does not replace the newer one");
  d.fromWorker({ v: "w1", id: "n-2", push: NOW - 1000 });
  assert.deepEqual(d.current(), { v: "w1", id: "n-2", push: NOW - 1000 });
  d.note({ foreground: NOW });
  d.note({ foreground: NOW + 1 });
  assert.equal(d.current().foreground, NOW + 1, "the latest look is kept");
  assert.ok(changes.length > 0);
  // A look long after the notice adds nothing to it.
  const stale = createPushDiagnostics({ storage: memory({ v: "w", id: "old", push: NOW - 3_600_000 }) });
  stale.note({ query: NOW });
  assert.equal(stale.current().query, undefined);
  // Storage that throws still works.
  const blocked = createPushDiagnostics({ storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
  blocked.note({ banner: NOW }, "n-9");
  assert.equal(blocked.current().id, "n-9");
});

test("a record is sent again only when a step changed, and only about a notice from the last 10 minutes", () => {
  const record = { v: "x", id: "n-1", push: NOW - 1000, foreground: NOW };
  assert.equal(pushDiagnosticSignature(record), pushDiagnosticSignature({ ...record, foreground: NOW + 5000 }));
  assert.notEqual(pushDiagnosticSignature(record), pushDiagnosticSignature({ ...record, banner: NOW }));
  assert.equal(recentPushDiagnostic(record, NOW), true);
  assert.equal(recentPushDiagnostic({ ...record, push: NOW - 11 * 60_000 }, NOW), false);
  assert.equal(recentPushDiagnostic({ v: "x", id: "n", foreground: NOW }, NOW), false);
});

test("the server's limit allows a few tests and refuses a flood, per account", () => {
  const allow = createPushDiagnosticLimiter(3, 1000);
  assert.deepEqual([0, 1, 2, 3].map(i => allow("a", i)), [true, true, true, false]);
  assert.equal(allow("b", 3), true);
  assert.equal(allow("a", 1001), true, "allowed again once the window has passed");
});

test("the owner's settings page lists the steps in Japanese and English, saying when the tap never reached the worker", () => {
  const at = Date.UTC(2026, 10, 15, 3, 0, 0);
  const record = { v: "2026-11-15-inapp-banner", id: "n-1", push: at, shown: at + 400, listApi: true, listed: true, foreground: at + 9000, banner: at + 9100,
    bannerOpen: at + 12_000, navigated: at + 12_000, via: "banner", stillListed: true, controlled: true, standalone: true };
  const ja = pushDiagnosticRows(record, "ja");
  assert.deepEqual(ja.find(row => row.label === "タップがワーカーに届いた").value, "届いていません");
  assert.match(ja.find(row => row.label === "通知のページへ移動").value, /\(\+12\.0s\) · アプリ内の通知$/);
  assert.equal(ja.find(row => row.label === "ワーカーの版").value, "2026-11-15-inapp-banner");
  assert.equal(ja.some(row => row.label === "記録したタップを見つけた"), false, "a step that did not happen is not listed");
  const en = pushDiagnosticRows({ ...record, click: at + 8000 }, "en");
  assert.match(en.find(row => row.label === "Tap reached the worker").value, /\(\+8\.0s\)$/);
  assert.equal(en.find(row => row.label === "Can list notifications").value, "yes");
});

test("the panel is collapsed under 「通知の動作の記録」 and says when nothing is recorded yet", () => {
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/research/push-diagnostic-panel.tsx", import.meta.url), "utf8"),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = (text, lang) => {
    const target = { exports: {} };
    new Function("require", "module", "exports", source)(id => {
      if (id === "react") return { ...React, useSyncExternalStore: () => text };
      if (id === "@/lib/research/push-diagnostic") return { cleanPushDiagnostic, pushDiagnosticRows, PUSH_DIAG_EVENT: "e", PUSH_DIAG_STORAGE_KEY };
      if (id === "@/lib/research/push-sw-facts") return { pushSwFactRows, readPushSwFacts, reinstallMessage };
      if (id.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      return require(id);
    }, target, target.exports);
    return renderToStaticMarkup(React.createElement(target.exports.default, { lang, onReinstall }));
  };
  let onReinstall;
  const empty = render("", "ja");
  assert.match(empty, /^<details class="diagnostic"><summary>通知の動作の記録<\/summary>/);
  assert.doesNotMatch(empty, /<details[^>]* open/);
  assert.match(empty, /まだ記録がありません/);
  // The live facts are read in the browser after the first paint; the reinstall button is only there when the page gives it.
  assert.match(empty, /この端末の状態（いま読み取った値）<\/p><p class="note">読み取り中…<\/p>/);
  assert.doesNotMatch(empty, /通知の仕組みを入れ直す/);
  onReinstall = async () => ({ ok: true });
  assert.match(render("", "ja"), /<button type="button" class="testButton">通知の仕組みを入れ直す<\/button>/);
  onReinstall = undefined;
  const full = render(JSON.stringify({ v: "x", id: "n-1", push: NOW }), "en");
  assert.match(full, /<summary>Notification step record<\/summary>/);
  assert.match(full, /Latest notice<\/p><dl class="diagnosticList">/);
  assert.match(full, /<dt>Notice id \(random\)<\/dt><dd>n-1<\/dd>/);
});
