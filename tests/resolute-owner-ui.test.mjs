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

test("every Clerk screen shares one appearance with readable inputs and one-line buttons", async () => {
  const look = await read("../lib/clerk-appearance.ts");
  assert.match(look, /otpCodeFieldInput: \{ color: text/);
  assert.match(look, /formFieldInput: \{ color: text/);
  assert.match(look, /whiteSpace: "nowrap"/);
  assert.match(look, /profileSection__danger: \{ display: "none" \}/);
  assert.match(await read("../app/research/identity-provider.tsx"), /appearance=\{clerkAppearance\}/);
  for (const path of ["../app/resolute/page.tsx", "../app/resolute/checkout/page.tsx", "../app/resolute/settings/page.tsx"]) {
    assert.match(await read(path), /<ClerkProvider appearance=\{clerkAppearance\}/, path);
  }
});

test("members without two-step verification are invited to turn it on, and can close the invitation", async () => {
  const view = await read("../app/research/account/account-view.tsx");
  assert.match(view, /!owner && twoFactor === false && nudge === "shown"/);
  assert.match(view, /href="\/research\/account\/security"/);
  assert.match(view, /tech-phase:two-step-nudge-until/);
  assert.match(view, /14 \* 86_400_000/);
});

test("the security page sits inside the site frame with a proper heading and back button", async () => {
  const screen = await read("../app/research/account/security/screen.tsx");
  assert.match(screen, /<ResearchToolShell/);
  assert.match(screen, /title=\{ja \? "セキュリティ"/);
  assert.match(screen, /href="\/research\/account"/);
  assert.match(screen, /<UserProfile routing="hash" \/>/);
});

test("after the sign-in code the screen waits without an empty framed card", async () => {
  const screen = await read("../app/research/account/screen.tsx");
  assert.match(screen, /const waiting = /);
  assert.match(screen, /\{waiting \? <div className=\{styles\.placeholder\}/);
  assert.match(screen, /<section className=\{styles\.card\}>/);
  const css = await read("../app/research/account/styles.module.css");
  assert.doesNotMatch(css, /\.placeholder\{[^}]*(border|background)/);
});

test("RESOLUTE pages start below the in-app view's floating buttons on iPhone", async () => {
  const hook = await read("../app/resolute/use-open-at-top.ts");
  assert.match(hook, /safe-area-inset-top/);
  assert.match(hook, /dataset\.overlayBar="1"/);
  assert.match(hook, /standalone/);
  assert.match(await read("../app/resolute/diagnosis.module.css"), /html\[data-overlay-bar="1"\]\) \.homeWrap/);
  assert.match(await read("../app/resolute/lp/lp.module.css"), /html\[data-overlay-bar="1"\]\) \.lp/);
});

test("RESOLUTE has its own home-screen app: manifest, icons, scope and a hint to add it", async () => {
  const manifest = JSON.parse(await read("../public/resolute.webmanifest"));
  assert.equal(manifest.name, "RESOLUTE");
  assert.equal(manifest.start_url, "/resolute");
  assert.equal(manifest.scope, "/resolute");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) assert.ok((await readFile(new URL(`../public${icon.src}`, import.meta.url))).length > 1000, icon.src);
  const layout = await read("../app/resolute/layout.tsx");
  assert.match(layout, /manifest: "\/resolute\.webmanifest"/);
  assert.match(layout, /appleWebApp: \{ capable: true, title: "RESOLUTE" \}/);
  assert.match(layout, /resolute-180\.png/);
  const tech = await read("../app/manifest.ts");
  assert.match(tech, /scope: "\/research"/, "the Tech Phase app keeps its own scope");
  assert.match(await read("../app/resolute/add-to-home-steps.tsx"), /ホーム画面に追加/);
  assert.match(await read("../app/resolute/tool-shell.tsx"), /<AddToHomeCard en=\{en\} \/>/);
  assert.match(await read("../app/resolute/lp/landing.tsx"), /<AddToHomeSteps className=\{s\.homeSteps\} \/>/);
});

test("while access is being checked RESOLUTE shows its logo and 確認中…, never an empty framed card", async () => {
  const shell = await read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /className=\{styles\.loadingBrand\}/);
  assert.match(shell, /確認中…/);
  assert.doesNotMatch(shell, /利用権を確認しています…["']\)? *:/ , "the checking message no longer sits in the card");
});

test("the RESOLUTE menu always offers the way back to Tech Phase", async () => {
  assert.match(await read("../app/resolute/tool-shell.tsx"), /href="\/research" prefetch=\{false\}>\{en\?"← Tech Phase":"← Tech Phaseへ"\}/);
});
