import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the weekly notebook preference is saved to the server and never re-sent from this browser", () => {
  const panel = read("../app/research/notification-settings.tsx");
  assert.match(panel, /action: "save-preferences"/);
  assert.match(panel, /action: "preferences"/);
  assert.doesNotMatch(panel, /notebook-weekly-push/); // no browser copy of the choice
  assert.doesNotMatch(panel, /weeklyNotebook: /);
  assert.match(read("../app/api/research/notifications/route.ts"), /weeklyNotebook: body\.weeklyNotebook !== false/);
  assert.match(read("../scripts/research/web_push.py"), /payload\.get\('weeklyNotebook'\) is False/);
});

test("the monitor loop sends the notebook notice after the price-target pass", () => {
  const service = read("../scripts/research/service.py");
  assert.ok(service.indexOf("web_push.deliver(db, items)") < service.indexOf("web_push.deliver_weekly(db)"));
});
