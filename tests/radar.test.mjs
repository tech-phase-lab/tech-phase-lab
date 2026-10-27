import assert from "node:assert/strict";
import test from "node:test";
import { arrow, beyondText, buildRadar, isBeyond, placeLabels, radarGenre, radarGenres, sizeTiers, xPosition, yPosition, zoneOf } from "../lib/research/radar.ts";

const snap = (end, ocfMargin, cover, revenue = 1e9, revenueGrowth = 10) => ({ end, basis: "ttm", revenue, ocfMargin, fcfMargin: ocfMargin - 5, cover, revenueGrowth });

test("genres list unique tickers", () => {
  for (const genre of radarGenres) assert.equal(new Set(genre.tickers).size, genre.tickers.length);
  assert.equal(radarGenre("semis")?.ja, "半導体");
  assert.equal(radarGenre("nope"), undefined);
});

test("ticks are evenly spaced and values beyond the range stop at the edge", () => {
  const xs = [-40, -20, 0, 20, 40, 60].map(xPosition), ys = [0.25, 0.5, 1, 2, 4].map(yPosition);
  for (const [i, x] of xs.entries()) assert.ok(Math.abs(x - i / 5) < 1e-9);
  for (const [i, y] of ys.entries()) assert.ok(Math.abs(y - i / 4) < 1e-9);
  assert.equal(xPosition(-1500), 0); assert.equal(xPosition(300), 1);
  assert.equal(yPosition(0.001), 0); assert.equal(yPosition(1000), 1); assert.equal(yPosition(Number.POSITIVE_INFINITY), 1);
  assert.equal(isBeyond(-180, 1), true); assert.equal(isBeyond(-35, 1), false); assert.equal(isBeyond(10, 44), true);
});

test("a dot stopped at the edge shows its real value beside it", () => {
  assert.equal(beyondText(-180, 1), "◀ -180%");
  assert.equal(beyondText(-52.4, 1), "◀ -52.4%");
  assert.equal(beyondText(80, 1), "80.0% ▶");
  assert.equal(beyondText(10, 44), "▲ 44x");
  assert.equal(beyondText(-180, 0.1), "◀ -180% ▼ 0.10x");
  assert.equal(beyondText(10, 1), "");
});

test("zones: 盤石 / 借入で攻める / 守りで耐える / 余力が小さい", () => {
  assert.equal(zoneOf(10, 2), "solid"); assert.equal(zoneOf(10, 0.5), "lever");
  assert.equal(zoneOf(-5, 2), "guard"); assert.equal(zoneOf(-5, 0.5), "thin");
  assert.equal(zoneOf(0, 1), "solid");
});

test("three dot sizes by revenue rank inside the genre", () => {
  assert.deepEqual(sizeTiers({ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 }), { A: 1, B: 1, C: 2, D: 2, E: 3, F: 3 });
  assert.deepEqual(sizeTiers({ A: 5 }), { A: 1 });
});

test("arrows compare with the previous earnings", () => {
  assert.equal(arrow(47, 40), "up"); assert.equal(arrow(25, 28), "down"); assert.equal(arrow(25, 25), null); assert.equal(arrow(25, undefined), null);
  assert.equal(arrow(3.2, 3.95), "down");
});

test("a FREE payload holds positions, colours and sizes only", () => {
  const entries = [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, 2, 5e9, 12), previous: snap("2026-03-31", 15, 3) } }, { ticker: "B", facts: { latest: snap("2026-06-30", -30, 0.4, 1e9, -3), previous: null } }, { ticker: "C", facts: { latest: null, previous: null } }];
  const free = buildRadar("semis", entries, "free");
  assert.equal(free.tier, "free");
  const text = JSON.stringify(free);
  for (const secret of ["previous", "growth", "asOf", "basis", "missing", "rank", "2026", "fcfMargin"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(free.dots.map(d => [d.ticker, d.up, d.tone, d.size]), [["A", true, "up", 2], ["B", false, "down", 1]]);
});

test("a PRO payload adds movement, numbers, ranking order and the missing list", () => {
  const entries = [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, 2, 5e9, 12), previous: snap("2026-03-31", 15, 3) } }, { ticker: "B", facts: { latest: snap("2026-05-31", -30, 0.4, 1e9, -3), previous: null } }, { ticker: "C", facts: { latest: null, previous: null } }];
  const pro = buildRadar("semis", entries, "pro");
  assert.equal(pro.tier, "pro");
  assert.deepEqual(pro.missing, ["C"]); assert.equal(pro.asOf, "2026-06-30");
  assert.deepEqual(pro.dots.map(d => [d.ticker, d.rank]), [["A", 1], ["B", 2]]);
  assert.deepEqual(pro.dots[0].previous, { ocfMargin: 15, cover: 3, asOf: "2026-03-31" }); assert.equal(pro.dots[0].fcfMargin, 15); assert.equal(pro.dots[1].previous, null);
  assert.equal(pro.dots[0].growth, 12);
});

test("an unlimited cover is sent as a finite number", () => {
  const pro = buildRadar("semis", [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, Infinity), previous: null } }], "pro");
  assert.equal(pro.dots[0].cover, 1000);
  JSON.stringify(pro);
});

test("a dot without a year-on-year comparison is hollow and takes its colour from the previous earnings", () => {
  const dot = (growth, previousRevenue, revenue = 2e9) => buildRadar("semis", [{ ticker: "A", facts: { latest: { ...snap("2026-06-30", 10, 2, revenue, growth), revenueGrowth: growth }, previous: previousRevenue === undefined ? null : snap("2026-03-31", 10, 2, previousRevenue) } }], "free").dots[0];
  assert.deepEqual([dot(null, 1e9).up, dot(null, 1e9).tone], [null, "up"]);
  assert.deepEqual([dot(null, 3e9).up, dot(null, 3e9).tone], [null, "down"]);
  assert.deepEqual([dot(null, undefined).up, dot(null, undefined).tone], [null, null]);
  assert.deepEqual([dot(12, 3e9).up, dot(12, 3e9).tone], [true, "up"]);   // the year-on-year figure wins
});

test("labels sit beside their own dot; crowded ones move up or down and are joined to the dot", () => {
  const bounds = { left: 0, top: 0, right: 300, bottom: 300 };
  const inputs = [["A", 100, 100], ["B", 106, 104], ["C", 112, 98], ["D", 104, 112], ["E", 290, 20], ["F", 10, 290]].map(([id, x, y]) => ({ id, x, y, r: 6, w: 34 }));
  const boxes = placeLabels(inputs, bounds);
  const list = Object.values(boxes);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i}/${j} overlap`);
  }
  for (const input of inputs) {
    const box = boxes[input.id];
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 300 && box.y + box.h <= 300);
    const nx = Math.min(Math.max(input.x, box.x), box.x + box.w), ny = Math.min(Math.max(input.y, box.y), box.y + box.h);
    assert.ok(Math.hypot(nx - input.x, ny - input.y) >= input.r, `${input.id} label covers its dot`);
    // beside the dot: the label's vertical span stays within a few lines of the dot, and it is at its left or right
    assert.ok(box.x >= input.x + input.r || box.x + box.w <= input.x - input.r, `${input.id} not beside its dot`);
    assert.equal(box.shifted, Math.abs(box.y + box.h / 2 - input.y) > 1);
  }
  assert.equal(boxes.E.shifted, false);   // alone: right beside, no line
  assert.ok(Object.values(boxes).some(box => box.shifted)); // the crowd needed lines
  assert.equal(boxes.E.x + boxes.E.w <= 300, true); // at the right edge it goes to the left of its dot
});

test("labels keep clear of the zone names", () => {
  const avoid = [{ x: 4, y: 3, w: 62, h: 13 }];
  const boxes = placeLabels([{ id: "A", x: 20, y: 14, r: 5, w: 30 }], { left: 0, top: 0, right: 300, bottom: 300 }, 11, avoid);
  const b = boxes.A;
  assert.ok(b.x >= 66 || b.y >= 16 || b.y + b.h <= 3 || b.x + b.w <= 4);
});
