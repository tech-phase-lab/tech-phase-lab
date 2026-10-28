import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { capitalProfiles } from "../lib/research/capital-map-profiles.ts";

test("capital map portraits are small local files, with their credit and licence kept", async () => {
  const withPortrait = Object.entries(capitalProfiles).filter(([, profile]) => profile.portrait);
  assert.ok(withPortrait.length >= 7);
  for (const [key, profile] of withPortrait) {
    const { url, credit, license, source } = profile.portrait;
    assert.match(url, /^\/capital-map\/[a-z]+\.webp$/, key);
    // Shown at 64 px: a few kilobytes, not the full-size photograph.
    const { size } = await stat(new URL(`../public${url}`, import.meta.url));
    assert.ok(size > 1000 && size < 40_000, `${key}: ${size} bytes`);
    assert.ok(credit && license && /^https:\/\/commons\.wikimedia\.org\//.test(source), key);
  }
});
