import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the notification screen follows the Nov 4 design: on/off list up top, details in one card at the bottom", () => {
  const view = read("../app/research/notification-page-view.tsx");
  for (const text of ["目標株価の変更", "決算の速報", "監視株ニュース", "経済指標", "銘柄手帳のまとめ", "週刊PRO", "ひとりごと", "リゼルに聞く", "詳しい設定", "決算の対象", "経済指標の種類", "おやすみモード", "運営者だけ", "オンにする"])
    assert.ok(view.includes(text), text);
  assert.ok(!view.includes("NEW"), "no NEW mark");
  assert.doesNotMatch(view, /t\("銘柄のニュース"/, "renamed to 監視株ニュース");
  assert.match(view, /weeklyIssue: false, rizelAnswer: false, quiet: \{ on: true, start: 23, end: 7 \}/);
  assert.match(read("../app/research/notifications/page.tsx"), /詳しい設定 ↓/);
});

test("the ten indicators start with seven on, and the one without a result reader (jobless claims) is marked as coming", () => {
  const view = read("../app/research/notification-page-view.tsx");
  assert.match(view, /defaultKinds = \["jobs", "cpi", "ppi", "pce", "fomc", "adp", "ism"\]/);
  for (const key of ["jobs", "cpi", "ppi", "pce", "fomc", "adp", "ism", "gdp", "retail", "claims"]) assert.ok(view.includes(`key: "${key}"`), key);
  assert.equal((view.match(/ready: false/g) ?? []).length, 1);
  assert.match(view, /key: "claims"[^\n]*ready: false/);
});

test("the monitor sends the new notices, and the site gives the monitor the question key", () => {
  const service = read("../scripts/research/service.py");
  for (const call of ["deliver_weekly_issues(db, weekly_issue_list)", "deliver_answers(db, answered)", "deliver_economic(db, economic)"]) assert.ok(service.includes(`web_push.${call}`), call);
  assert.match(read("../app/api/research/notifications/route.ts"), /questionOwner: createHmac\("sha256", process\.env\.RESEARCH_MONITOR_TOKEN/);
  const python = read("../scripts/research/web_push.py");
  assert.match(python, /def quiet_blocks/);
  assert.match(python, /'quiet_on', 'INTEGER NOT NULL DEFAULT 1'/);
});
