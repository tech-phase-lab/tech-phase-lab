import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { companyWireDelay, COMPANY_WIRE_REFRESH_MS } from "../lib/research/company-wire.ts";

const page = readFileSync(new URL("../app/research/news/flash-page.tsx", import.meta.url), "utf8");

test("company headlines that fail before the first load are retried within seconds, then refresh once a minute", () => {
  assert.equal(COMPANY_WIRE_REFRESH_MS, 60_000);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map(failures => companyWireDelay(false, failures)), [3_000, 6_000, 12_000, 24_000, 30_000, 30_000, 30_000]);
  assert.equal(companyWireDelay(false, 0), 60_000);
  // Once a list has loaded, a later failure keeps it and waits for the normal minute.
  assert.equal(companyWireDelay(true, 0), 60_000);
  assert.equal(companyWireDelay(true, 3), 60_000);
});

test("the 速報 page schedules the next company-wire load from that delay, not a fixed 60 s interval", () => {
  assert.match(page, /setTimeout\(run, companyWireDelay\(loaded, failures\)\)/);
  assert.doesNotMatch(page, /setInterval\(load, 60_000\)/);
  assert.match(page, /if \(!response\.ok\) return false;/);
  assert.match(page, /catch \{ return false;/);
  assert.match(page, /if \(ok\) \{ loaded = true; failures = 0; \} else if \(!loaded\) failures \+= 1;/);
});

test("a quiet loading line stands in for the company news until it arrives, and only then", () => {
  assert.match(page, /wireSettled && !wireLoaded && view === "all" && <p className=\{timeline\.fine\} role="status">\{ja \? "ニュースを読み込んでいます" : "Loading news…"\}<\/p>/);
  assert.match(page, /setWire\(items\); setWireLoaded\(true\);/);
  // FREE / PRO handling and owner access stay as they were.
  // Speed, Nov 26: until the browser's check answers, the server's own verdict (it drew the full feed only for PRO / an owner account).
  assert.match(page, /const full = \(!memberSettled && initial\?\.full === true\) \|\| memberPlan === "pro" \|\| ownerAccount \|\| ownerRole;/);
  assert.match(page, /const rows = full \? allRows : freeFlashRows\(allRows/);
});
