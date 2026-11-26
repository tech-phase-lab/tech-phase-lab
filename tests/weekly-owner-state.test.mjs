import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Production, Nov 26: /research/weekly crashed for the owner because the server page called ownerState() from a "use client" module.
test("the weekly page's server code takes ownerState from a server-safe module", () => {
  const page = readFileSync("app/research/weekly/page.tsx", "utf8");
  const helper = readFileSync("app/research/weekly/owner-state.ts", "utf8");
  assert.doesNotMatch(helper, /^\s*["']use client["']/m);
  assert.match(page, /import \{ ownerState \} from "\.\/owner-state"/);
  assert.doesNotMatch(page, /import WeeklyIssues, \{[^}]*\bownerState\b/);
});
