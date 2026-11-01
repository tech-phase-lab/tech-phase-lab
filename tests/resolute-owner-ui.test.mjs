import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("RESOLUTE tells the owner when two-step verification is missing in this sign-in", async () => {
  const shell = await read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /r\.status===403/);
  assert.match(shell, /OWNER_MFA_REQUIRED/);
  assert.match(shell, /access==="mfa"/);
  assert.match(shell, /2段階認証のコード入力が必要です/);
  assert.match(shell, /\/research\/account\/security/);
  // A 403 must never be treated as a granted or purchased state.
  assert.doesNotMatch(shell, /r\.status===403[^}]*setAccess\("allowed"\)/);
});

test("switching the owner view forgets the remembered RESOLUTE answer and asks again", async () => {
  const view = await read("../app/research/account/account-view.tsx");
  assert.match(view, /removeItem\("tech-phase:resolute-bar-state:v1"\)/);
  assert.match(view, /dispatchEvent\(new Event\("tech-phase:resolute-bar"\)\)/);
});

test("the owner opens the RESOLUTE home directly, without the first-time quiz", async () => {
  const gate = await read("../app/resolute/entry-gate.tsx");
  assert.match(gate, /accessBasis === "owner" && body\.canUseTools === true/);
  assert.match(gate, /FIRST_VISIT_KEY, "1"/);
});

test("RESOLUTE tool pages and both landing pages open at the very top", async () => {
  const hook = await read("../app/resolute/use-open-at-top.ts");
  assert.match(hook, /scrollRestoration="manual"/);
  assert.match(hook, /window\.scrollTo\(0,0\)/);
  assert.match(await read("../app/resolute/tool-shell.tsx"), /useOpenAtTop\(\)/);
  assert.match(await read("../app/resolute/lp/landing.tsx"), /<OpenAtTop \/>/);
  assert.match(await read("../app/resolute/lp/landing-en.tsx"), /<OpenAtTop \/>/);
});

test("the RESOLUTE bar measures the bottom menu again after returning and when the viewport moves", async () => {
  const bar = await read("../app/research/resolute-bar.tsx");
  assert.match(bar, /addEventListener\("pageshow", place\)/);
  assert.match(bar, /visualViewport/);
  assert.match(bar, /ResizeObserver/);
  assert.match(bar, /\[60, 250, 700, 1500, 3000\]/);
});

test("the owner can open the security page to set up two-step verification when it is not on", async () => {
  const view = await read("../app/research/account/account-view.tsx");
  assert.match(view, /owner && twoFactor === true \? row\(I\.shield/);
  assert.match(view, /row\(I\.shield, t\("2段階認証", "Two-step verification"\), \{ href: "\/research\/account\/security", value: twoValue \}\)/);
});
