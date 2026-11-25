import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("資本マップ: no 「株数変化なし」 and no 「保有増加/減少」 under the signed %; 新規保有 and 保有解消 stay (owner, Nov 25)", () => {
  const screen = read("../app/research/capital-map/screen.tsx");
  for (const gone of ["株数変化なし", "No change in shares held", "保有増加", "保有減少"]) assert.ok(!screen.includes(gone), gone);
  assert.match(screen, /const labels: Partial<Record<string, string>> = \{ new: t\("新規保有", "New"\), exited: t\("保有解消", "Exited"\) \};/);
  assert.match(screen, /row\.shareChangePercent !== null && labels\[row\.change\] && <small>/);
});

test("ハイテク速報: no 「発表 …」 line under each item; RESOLUTE LP: no home-screen steps (owner, Nov 25)", () => {
  const flash = read("../app/research/news/flash-page.tsx");
  assert.ok(!/const publication = /.test(flash));
  assert.match(flash, /publication="" capDetail/);
  const lp = read("../app/resolute/lp/landing.tsx");
  assert.ok(!lp.includes("ON YOUR HOME SCREEN") && !lp.includes("ホーム画面に置いて"));
  assert.match(read("../app/resolute/settings/screen.tsx"), /<AddToHomeSteps/);
});
