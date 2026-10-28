import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.ts";

test("fonts and images are kept by the browser; account and billing pages keep their security headers", async () => {
  const rules = await config.headers();
  const value = source => rules.find(rule => rule.source === source)?.headers.find(h => h.key === "Cache-Control")?.value;
  assert.match(value("/fonts/:path*"), /max-age=31536000, immutable/);
  assert.match(value("/brand/:path*"), /max-age=604800/);
  assert.match(value("/rizel-avatar.webp"), /stale-while-revalidate/);
  assert.equal(rules.find(rule => rule.source === "/research/account/:path*")?.headers.some(h => h.key === "X-Frame-Options"), true);
  // Pages and APIs are never given a long cache.
  assert.equal(rules.some(rule => /^\/(research|api)\b/.test(rule.source) && rule.headers.some(h => h.key === "Cache-Control")), false);
});
