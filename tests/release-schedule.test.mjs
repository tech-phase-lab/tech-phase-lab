import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { releaseSchedule } from "../lib/research/release-schedule.ts";

test("the monitor release watch mirrors every timed calendar event", async () => {
  const shipped = JSON.parse(await readFile(new URL("../scripts/research/release_schedule.json", import.meta.url), "utf8"));
  // Regenerate with: node --experimental-strip-types scripts/export_release_schedule.mjs
  assert.deepEqual(shipped, { version: 1, events: releaseSchedule() });
  const cpi = shipped.events.find(event => event.id === "cpi-2026-10-14");
  assert.deepEqual(cpi, { id: "cpi-2026-10-14", kind: "economic", indicator: "cpi", phase: "release",
    at: "2026-10-14T12:30:00.000Z", titleJa: "米国CPI（消費者物価指数）" });
  assert.equal(shipped.events.find(event => event.id === "asml-q3-2026-call").phase, "call");
});
