import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("both installed apps cover the whole site so links between /research and /resolute stay in the app (owner, Nov 17)", () => {
  const techPhase = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  assert.match(techPhase, /id: "\/research"/);
  assert.match(techPhase, /start_url: "\/research", scope: "\/"/);
  const resolute = JSON.parse(readFileSync(new URL("../public/resolute.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual([resolute.id, resolute.start_url, resolute.scope], ["/resolute", "/resolute", "/"]);
});
