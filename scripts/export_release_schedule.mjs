// Writes scripts/research/release_schedule.json from the timed calendar events.
// Run: node --experimental-strip-types scripts/export_release_schedule.mjs
// tests/release-schedule.test.mjs fails when the two drift apart.
import { writeFileSync } from "node:fs";
import { releaseSchedule } from "../lib/research/release-schedule.ts";

writeFileSync(new URL("./research/release_schedule.json", import.meta.url),
  JSON.stringify({ version: 1, events: releaseSchedule() }, null, 2) + "\n");
