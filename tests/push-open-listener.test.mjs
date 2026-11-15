import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handlePushOpenMessage, pushOpenPath, PUSH_OPENABLE } from "../lib/research/push-open.ts";
import targets from "../lib/research/push-targets.json" with { type: "json" };

const here = { origin: "https://techphase.app", pathname: "/research/compare", hash: "" };
function receive(data, location = here, extra = {}) {
  const moves = [], answers = [];
  const result = handlePushOpenMessage({ data, origin: location.origin, ports: [{ postMessage: m => answers.push(m) }], ...extra }, location,
    { push: href => moves.push(["push", href]), setHash: hash => moves.push(["hash", hash]) });
  return { result, moves, answers };
}

test("the app accepts the same pages as the service worker", () => {
  assert.deepEqual([...PUSH_OPENABLE].sort(), [...targets.openable].sort());
  for (const path of targets.openable) assert.equal(pushOpenPath({ type: "open", url: path }), path);
  assert.equal(pushOpenPath({ type: "open", url: "/research#what-changed" }), "/research#what-changed");
});

test("Nov 15: an open message moves the app from its last page to the notice's page and confirms", () => {
  const { result, moves, answers } = receive({ type: "open", url: "/research/notebook" });
  assert.equal(result, "/research/notebook");
  assert.deepEqual(moves, [["push", "/research/notebook"]]);
  assert.deepEqual(answers, [{ type: "opened" }]);
});

test("a fragment on the page already shown changes only the hash, so the page's own view switch runs", () => {
  assert.deepEqual(receive({ type: "open", url: "/research#what-changed" }, { ...here, pathname: "/research" }).moves, [["hash", "#what-changed"]]);
  assert.deepEqual(receive({ type: "open", url: "/research#what-changed" }, { ...here, pathname: "/research", hash: "#what-changed" }).moves, []);
  assert.deepEqual(receive({ type: "open", url: "/research/qa#q-0123456789abcdef0123456789abcdef" }).moves, [["push", "/research/qa#q-0123456789abcdef0123456789abcdef"]]);
});

test("anything off the list, of another kind or from another origin is ignored and not confirmed", () => {
  for (const data of [null, "open", { type: "other", url: "/research/news" }, { type: "open" }, { type: "open", url: "/admin" },
    { type: "open", url: "javascript:alert(1)" }, { type: "open", url: "//evil.example/research" }, { type: "open", url: "https://evil.example/research" },
    { type: "open", url: "/research/calendar?x=1" }, { type: "open", url: "/research#<x>" }, { type: "open", url: "/" }]) {
    const { result, moves, answers } = receive(data);
    assert.equal(result, null, JSON.stringify(data));
    assert.deepEqual(moves, []); assert.deepEqual(answers, []);
  }
  assert.equal(receive({ type: "open", url: "/research/news" }, here, { origin: "https://evil.example" }).result, null);
});

test("the listener is mounted in the research layout and listens to the service worker", () => {
  const layout = fs.readFileSync(new URL("../app/research/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /import PushOpenListener from "\.\/push-open-listener";/);
  assert.match(layout, /<PushOpenListener \/>/);
  const listener = fs.readFileSync(new URL("../app/research/push-open-listener.tsx", import.meta.url), "utf8");
  assert.match(listener, /^"use client";/);
  assert.match(listener, /navigator\.serviceWorker[\s\S]*addEventListener\("message", onMessage\)/);
  assert.match(listener, /handlePushOpenMessage\(event, window\.location/);
  assert.match(listener, /removeEventListener\("message", onMessage\)/);
  assert.match(listener, /registration\?\.update\(\)/);
});
