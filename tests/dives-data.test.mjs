import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDive } from "../lib/research/watch-earnings.ts";

const dir = new URL("../lib/research/dives/", import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith(".json")).sort();

test("every lib/research/dives/*.json passes scripts/research/check_dives.py", () => {
  assert.ok(files.length > 0);
  const run = spawnSync("python3", ["scripts/research/check_dives.py"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("every dive file is accepted by parseDive with all four cards and three tiles", () => {
  for (const name of files) {
    const dive = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    const parsed = parseDive({ numbers: dive.numbers, summary: dive.summary, summaryAt: null });
    assert.ok(parsed?.numbers && parsed.summary, `${name} was rejected by parseDive`);
    assert.deepEqual(Object.keys(parsed.summary.cards).sort(), ["caution", "change", "growth", "next"], name);
    assert.equal(dive.tiles.length, 3, name);
  }
});
