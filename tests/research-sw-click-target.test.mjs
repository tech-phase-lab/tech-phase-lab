import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/research-sw.js", import.meta.url), "utf8");
const ORIGIN = "https://techphase.app";

function worker(openClients = []) {
  const listeners = {}, shown = [], opened = [], navigated = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    registration: { showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: {
      matchAll: async () => openClients.map(url => ({ url, navigate: async target => { navigated.push(target); }, focus: async () => "focused" })),
      openWindow: async target => { opened.push(target); },
    },
  };
  vm.runInNewContext(source, { self, URL, Set, Promise, String });
  const push = async data => {
    let waiting;
    await listeners.push({ data: { json: () => data }, waitUntil: p => { waiting = p; } });
    await waiting;
    return shown.at(-1);
  };
  const click = async data => {
    let waiting;
    listeners.notificationclick({ notification: { data, close() {} }, waitUntil: p => { waiting = p; } });
    await waiting;
  };
  return { push, click, shown, opened, navigated };
}

const sent = async url => (await worker().push({ title: "t", body: "b", ...(url === undefined ? {} : { url }) })).options.data.url;

test("known research pages are kept, with or without a hash", async () => {
  for (const url of ["/research/calendar", "/research/news", "/research/weekly", "/research/notebook", "/research/notes",
    "/research/notifications", "/research/price-targets", "/research/questions", "/research#what-changed", "/research"]) {
    assert.equal(await sent(url), url);
  }
});

test("unknown paths, queries, other origins and tricks fall back to /research", async () => {
  for (const url of ["/admin", "/research/other", "/research/calendar/x", "/research/calendar?x=1", "/research/calendar#a b", "/research#<x>",
    "https://evil.example/research/calendar", "https://techphase.app/research/calendar", "//evil.example/research/calendar",
    "/\\evil.example", "javascript:alert(1)", "research/calendar", "", 5, {}, "/research/" + "a".repeat(300)]) {
    assert.equal(await sent(url), "/research", String(url));
  }
});

test("an old notice without a url still opens price targets", async () => {
  assert.equal(await sent(undefined), "/research/price-targets");
  const w = worker();
  await w.click({});
  await w.click(undefined);
  assert.deepEqual(w.opened, [`${ORIGIN}/research/price-targets`, `${ORIGIN}/research/price-targets`]);
});

test("tapping opens the page the notice is about and never an external URL", async () => {
  const w = worker();
  await w.click({ url: "/research/calendar" });
  await w.click({ url: "/research#what-changed" });
  await w.click({ url: "https://evil.example/" });
  assert.deepEqual(w.opened, [`${ORIGIN}/research/calendar`, `${ORIGIN}/research#what-changed`, `${ORIGIN}/research`]);
});

test("an open Tech Phase research window is reused and navigated; other windows are not", async () => {
  const reuse = worker([`${ORIGIN}/research/news`]);
  await reuse.click({ url: "/research/calendar" });
  assert.deepEqual(reuse.navigated, [`${ORIGIN}/research/calendar`]);
  assert.deepEqual(reuse.opened, []);
  const other = worker(["https://evil.example/research", `${ORIGIN}/resolute`]);
  await other.click({ url: "/research/weekly" });
  assert.deepEqual(other.navigated, []);
  assert.deepEqual(other.opened, [`${ORIGIN}/research/weekly`]);
});
