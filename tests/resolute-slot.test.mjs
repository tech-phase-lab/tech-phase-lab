import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { noResoluteSlot, registerResoluteSlot, resoluteSlot, subscribeResoluteSlot } from "../lib/research/resolute-slot.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Nov 18 cold start: a bar that appears before the menu's slot is told when the slot arrives", () => {
  assert.equal(resoluteSlot(), null);
  assert.equal(noResoluteSlot(), null);
  let told = 0;
  const stop = subscribeResoluteSlot(() => { told++; });
  // The bar is already waiting (subscribed) when the menu mounts its slot.
  const slot = { id: "dock-1" };
  const leave = registerResoluteSlot(slot);
  assert.equal(told, 1);
  assert.equal(resoluteSlot(), slot);
  // Registering the same slot again changes nothing.
  registerResoluteSlot(slot);
  assert.equal(told, 1);
  leave();
  assert.equal(resoluteSlot(), null);
  assert.equal(told, 2);
  stop();
});

test("a replaced menu slot is followed, and the old slot leaving does not clear the new one", () => {
  const first = { id: "dock-1" }, second = { id: "dock-2" };
  let told = 0;
  const stop = subscribeResoluteSlot(() => { told++; });
  const leaveFirst = registerResoluteSlot(first);
  const leaveSecond = registerResoluteSlot(second);
  assert.equal(resoluteSlot(), second);
  leaveFirst();
  assert.equal(resoluteSlot(), second, "the newer slot stays");
  assert.equal(told, 2);
  leaveSecond();
  assert.equal(resoluteSlot(), null);
  stop();
  registerResoluteSlot(first)();
  assert.equal(told, 3, "an unsubscribed bar is not told");
  assert.equal(registerResoluteSlot(null), undefined);
});

test("the bar follows the registered slot and the menu registers its dock slot (no one-time lookup)", async () => {
  const bar = await read("../app/research/resolute-bar.tsx");
  assert.match(bar, /const slot = useSyncExternalStore\(subscribeResoluteSlot, resoluteSlot, noResoluteSlot\);/);
  assert.match(bar, /const host = shown \? slot : null;/);
  assert.match(bar, /if \(!shown \|\| !host\) return null;/);
  assert.doesNotMatch(bar, /querySelector[^\n]*data-resolute-slot/);
  assert.doesNotMatch(bar, /setHost/);
  // The owner still sees the bar in every view; FREE/PRO rules are unchanged.
  assert.match(bar, /barVisible\(state, dismissedAt, signedIn, openedAt, ownerAccount\)/);
  const nav = await read("../app/research/bottom-nav.tsx");
  assert.match(nav, /<div ref=\{registerResoluteSlot\} data-resolute-slot="" className=\{styles\.slot\} \/>/);
});
