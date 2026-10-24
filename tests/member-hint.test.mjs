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
