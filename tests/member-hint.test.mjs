import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/research/member-display-provider.tsx", import.meta.url), "utf8");

test("last verified paid state is only a display hint that the real check confirms or clears", () => {
  assert.match(source, /HINT_KEY = "tech-phase:member-hint"/);
  assert.match(source, /hint\.accessExpiresAt > Date\.now\(\)/);
  assert.match(source, /hint\?\.plan === "pro" \|\| hint\?\.ownerAccount === true/);
  assert.match(source, /ownerHint/);
  // The hint is rewritten (or cleared) from every verified answer.
  assert.match(source, /writeHint\(pro \|\| ownerHint \? \{/);
  assert.match(source, /: null\);/);
});

test('the pre-paint hint script exposes only an unexpired owner/PRO state on <html>', async () => {
  const { memberHintBoot } = await import('../lib/research/member-hint-boot.ts');
  const run = (hint) => {
    const root = { dataset: {} };
    new Function('localStorage', 'document', memberHintBoot)({ getItem: () => hint === undefined ? null : JSON.stringify(hint) }, { documentElement: root });
    return root.dataset.memberHint;
  };
  const later = Date.now() + 60_000;
  assert.equal(run({ plan: 'free', ownerAccount: true, accessExpiresAt: later }), 'owner');
  assert.equal(run({ plan: 'pro', ownerAccount: false, accessExpiresAt: later }), 'pro');
  assert.equal(run({ plan: 'pro', ownerAccount: false, accessExpiresAt: Date.now() - 1 }), undefined);
  assert.equal(run({ plan: 'free', accessExpiresAt: later }), undefined);
  assert.equal(run(undefined), undefined);
});

test('the owner hint outlives the owner access window (about an hour) so the next open still shows the header at once', () => {
  assert.match(source, /ownerHint \? Math\.max\(pro \? member\.accessExpiresAt : 0, Date\.now\(\) \+ 7 \* 24 \* 3_600_000\) : member\.accessExpiresAt/);
});
