import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the unread dot reads the alerts once for every menu, side by side, after the page's own data (speed, Nov 26)", () => {
  const hook = read("app/research/use-alerts-unread.ts");
  // The rules that pick the listed rows are not part of every page's first script.
  assert.doesNotMatch(hook, /^import \{ alertItems \}/m);
  assert.doesNotMatch(hook, /^import \{ parseCompanyWire \}/m);
  assert.match(hook, /import\("@\/lib\/research\/alert-items"\)/);
  // One shared read (phone menu and desktop sidebar), the two feeds in parallel, kept for a minute, dropped on a membership change.
  assert.match(hook, /if \(shared && Date\.now\(\) - shared\.at < FRESH_MS\) return shared\.items;/);
  assert.match(hook, /Promise\.all\(\[news, wire,/);
  assert.match(hook, /tech-phase:membership-changed", forgetShared/);
  // A failed read is not kept.
  assert.match(hook, /items\.catch\(\(\) => \{ if \(shared === entry\) shared = null; \}\);/);
  // Started when the page is idle (at most 2.5 s), not with the page's first requests.
  assert.match(hook, /const cancelStart = afterPageData\(\(\) => \{ void check\(\); \}\);/);
});

test("the identity refresh tells the membership check when nobody is signed in", () => {
  const provider = read("app/research/identity-provider.tsx");
  assert.match(provider, /if \(!isSignedIn\) return false;/);
  const recovery = read("lib/research/member-recovery.ts");
  assert.match(recovery, /result\.member\.status === "signed-out" && sdkSignedIn !== false/);
});
