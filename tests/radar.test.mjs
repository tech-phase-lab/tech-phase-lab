import assert from "node:assert/strict";
import test from "node:test";
import { arrow, beyondText, buildRadar, isBeyond, placeLabels, radarGenre, radarGenres, rankByScore, fitnessScore, earningScore, stayingScore, beyondDirections, formerGenres, sizeTiers, spreadEdgeDots, xPosition, yPosition, zoneOf, rankPlaces, proRankPlaces, zoneAt } from "../lib/research/radar.ts";

const snap = (end, ocfMargin, cover, revenue = 1e9, revenueGrowth = 10) => ({ end, basis: "ttm", revenue, ocfMargin, fcfMargin: ocfMargin - 5, cover, revenueGrowth });

test("genres list unique tickers", () => {
  for (const genre of radarGenres) assert.equal(new Set(genre.tickers).size, genre.tickers.length);
  assert.equal(radarGenre("semis")?.ja, "半導体");
  assert.equal(radarGenre("nope"), undefined);
});

test("ticks are evenly spaced and values beyond the range stop at the edge", () => {
  const xs = [-40, -20, 0, 20, 40, 60].map(xPosition), ys = [0.1, 0.25, 0.5, 1, 2, 4, 10].map(yPosition);
  for (const [i, x] of xs.entries()) assert.ok(Math.abs(x - i / 5) < 1e-9);
  assert.equal(ys[0], 0); assert.equal(ys[6], 1);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1]);
  // 0.5 → 1 → 2 → 4 are doublings: the same distance each
  const gaps = ys.slice(2, 6).map((y, i) => ys[i + 3] - y).slice(0, 3);
  for (const g of gaps) assert.ok(Math.abs(g - gaps[0]) < 1e-9);
  assert.equal(xPosition(-1500), 0); assert.equal(xPosition(300), 1);
  assert.equal(yPosition(0.001), 0); assert.equal(yPosition(1000), 1); assert.equal(yPosition(Number.POSITIVE_INFINITY), 1);
  assert.equal(isBeyond(-180, 1), true); assert.equal(isBeyond(-35, 1), false); assert.equal(isBeyond(10, 44), true); assert.equal(isBeyond(10, 5.74), false); assert.equal(isBeyond(10, 12), true);
});

test("a dot stopped at the edge shows its real value beside it", () => {
  assert.equal(beyondText(-180, 1), "◀ -180%");
  assert.equal(beyondText(-52.4, 1), "◀ -52.4%");
  assert.equal(beyondText(80, 1), "80.0% ▶");
  assert.equal(beyondText(10, 44), "▲ 44x");
  assert.equal(beyondText(-180, 0.05), "◀ -180% ▼ 0.05x");
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

test("a FREE payload holds rank places, colours and sizes only: never a figure (owner, Nov 25)", () => {
  const entries = [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, 2, 5e9, 12), previous: snap("2026-03-31", 15, 3) } }, { ticker: "B", facts: { latest: snap("2026-06-30", -30, 0.4, 1e9, -3), previous: null } }, { ticker: "C", facts: { latest: null, previous: null } }];
  const free = buildRadar("semis", entries, "free");
  assert.equal(free.tier, "free");
  const text = JSON.stringify(free.dots);
  for (const secret of ["previous", "growth", "asOf", "basis", "missing", "rank", "2026", "fcfMargin", "ocfMargin", "cover", "noRevenue", "score", "review", "prepaid"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(free.dots.map(d => [d.ticker, d.up, d.tone, d.size, d.x, d.y]), [["A", true, "up", 2, 0.75, 0.75], ["B", false, "down", 1, 0.25, 0.25]]);
  assert.equal(free.asOf, "2026-06-30"); // only the date of the latest results, for the ranking heading
  assert.deepEqual(Object.keys(free).sort(), ["asOf", "dots", "genre", "tier"]);
});

test("FREE places spread evenly by rank, ties are split by the genre's order, and a company without revenue earns the lowest rank", () => {
  const entries = [
    { ticker: "A", facts: { latest: snap("2026-06-30", 70, 0.05), previous: null } },
    { ticker: "B", facts: { latest: snap("2026-06-30", 70, 0.05), previous: null } },
    { ticker: "C", facts: { latest: snap("2026-06-30", -200, 30), previous: null } },
    { ticker: "D", facts: { latest: { ...snap("2026-06-30", -40, 3), noRevenue: true }, previous: null } },
  ];
  const dots = Object.fromEntries(buildRadar("semis", entries, "free").dots.map(d => [d.ticker, d]));
  assert.deepEqual(["A", "B", "C", "D"].map(t => dots[t].x), [0.625, 0.875, 0.375, 0.125]);
  assert.deepEqual(["A", "B", "C", "D"].map(t => dots[t].y), [0.125, 0.375, 0.875, 0.625]);
  assert.deepEqual(rankPlaces([{ ticker: "X", value: 1 }]), { X: 0.5 });
});

test("a PRO payload adds movement, numbers, ranking order and the missing list", () => {
  const entries = [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, 2, 5e9, 12), previous: snap("2026-03-31", 15, 3) } }, { ticker: "B", facts: { latest: snap("2026-05-31", -30, 0.4, 1e9, -3), previous: null } }, { ticker: "C", facts: { latest: null, previous: null } }];
  const pro = buildRadar("semis", entries, "pro");
  assert.equal(pro.tier, "pro");
  assert.deepEqual(pro.missing, ["C"]); assert.equal(pro.asOf, "2026-06-30");
  assert.deepEqual(pro.dots.map(d => [d.ticker, d.rank, d.review]), [["A", 1, false], ["B", 2, false]]);
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

test("labels stay clear of the dots and of each other; crowded ones are joined to their dot by a line", () => {
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
    // near its own dot (a crowded one may sit above or below, further out)
    assert.ok(Math.hypot(nx - input.x, ny - input.y) < 60, `${input.id} too far from its dot`);
    for (const other of inputs) if (other !== input) assert.ok(Math.hypot(Math.min(Math.max(other.x, box.x), box.x + box.w) - other.x, Math.min(Math.max(other.y, box.y), box.y + box.h) - other.y) >= other.r, `${input.id} covers ${other.id}`);
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

test("the fitness score is the average of the two chart points, and ties go to the stronger staying power", () => {
  assert.equal(earningScore(-40), 0); assert.equal(earningScore(60), 100); assert.equal(earningScore(10), 50); assert.equal(earningScore(297), 100); assert.equal(earningScore(-90), 0);
  assert.equal(stayingScore(0.1), 0); assert.ok(Math.abs(stayingScore(10) - 100) < 1e-9); assert.ok(Math.abs(stayingScore(1) - 50) < 1e-9); assert.equal(stayingScore(0.06), 0); assert.equal(stayingScore(1000), 100);
  assert.ok(Math.abs(fitnessScore(10, 1) - 50) < 1e-9);
  // A: 90 and 50; B: 80 and 73.8; C: 70 and 65.1; D: 50 and 100 (a cover beyond the edge counts as the edge)
  assert.deepEqual(rankByScore([{ ticker: "A", ocfMargin: 50, cover: 1 }, { ticker: "B", ocfMargin: 40, cover: 3 }, { ticker: "C", ocfMargin: 30, cover: 2 }, { ticker: "D", ocfMargin: 10, cover: 1000 }]), ["B", "D", "A", "C"]);
  // same score: 10%/1x and 60%/0.1x are both 50 points; the higher staying power is placed above
  assert.deepEqual(rankByScore([{ ticker: "A", ocfMargin: 10, cover: 1 }, { ticker: "B", ocfMargin: 60, cover: 0.1 }]), ["A", "B"]);
  assert.deepEqual(rankByScore([{ ticker: "B", ocfMargin: 60, cover: 0.1 }, { ticker: "A", ocfMargin: 10, cover: 1 }]), ["A", "B"]);
});

test("genres after the reclassification", () => {
  const of = id => radarGenre(id).tickers;
  assert.deepEqual(radarGenres.map(genre => genre.id), ["ai-cloud", "semis", "memory", "network", "photonics", "software", "power", "cyber"]);
  assert.deepEqual(radarGenres.map(genre => genre.ja), ["AIクラウド", "半導体", "メモリ", "通信", "光・フォトニクス", "ソフトウェア", "電力・設備", "サイバーセキュリティ"]);
  assert.deepEqual(radarGenres.map(genre => genre.en), ["AI Cloud", "Semiconductors", "Memory", "Networking", "Optics & photonics", "Software", "Power & Infrastructure", "Cybersecurity"]);
  assert.deepEqual(of("semis"), ["NVDA", "AMD", "INTC", "QCOM", "AMAT", "LRCX"]);
  assert.deepEqual(of("memory"), ["MU", "SNDK", "WDC", "STX", "RMBS", "P"]); // P: Everpure (formerly Pure Storage, PSTG)
  assert.deepEqual(of("network"), ["ANET", "MRVL", "CRDO", "APH", "ALAB", "CSCO"]);
  assert.deepEqual(of("photonics"), ["AAOI", "COHR", "LITE", "CIEN", "GLW", "AVGO", "FN"]);
  assert.deepEqual(of("power"), ["VST", "CEG", "GEV", "BE", "VRT", "ETN", "PWR", "OKLO"]);
  assert.deepEqual(of("cyber"), ["CRWD", "PANW", "ZS", "FTNT", "NET", "S", "OKTA"]);
  assert.ok(of("ai-cloud").includes("ORCL") && !of("software").includes("ORCL"));
  const all = radarGenres.flatMap(genre => genre.tickers);
  assert.equal(new Set(all).size, all.length);
  for (const [ticker, formers] of Object.entries(formerGenres)) { assert.ok(all.includes(ticker)); for (const former of formers) assert.ok(!radarGenre(former).tickers.includes(ticker)); }
});

test("a company with no revenue sits at the left edge, says so, and stays out of the ranking (the only one, Nov 24)", () => {
  const pre = { end: "2026-03-31", basis: "ttm", revenue: 0, ocfMargin: -1000, fcfMargin: -1000, cover: 600, revenueGrowth: null, noRevenue: true };
  const entries = [{ ticker: "A", facts: { latest: snap("2026-06-30", 20, 2), previous: null } }, { ticker: "OKLO", facts: { latest: pre, previous: snap("2025-12-31", 10, 3) } }];
  const pro = buildRadar("power", entries, "pro");
  const dot = pro.dots.find(d => d.ticker === "OKLO");
  assert.equal(dot.noRevenue, true); assert.equal(dot.rank, null); assert.equal(dot.review, false); assert.equal(dot.previous, null);
  assert.equal(pro.dots.find(d => d.ticker === "A").rank, 1);
  assert.equal(xPosition(dot.ocfMargin), 0);
  assert.ok(beyondText(dot.ocfMargin, dot.cover, true).includes("売上なし"));
  // FREE: no flag, the company simply takes the lowest earning-power rank (owner, Nov 25).
  assert.deepEqual(buildRadar("power", entries, "free").dots.map(d => [d.ticker, d.x, "noRevenue" in d]), [["A", 0.75, false], ["OKLO", 0.25, false]]);
});

test("arrows point the way a dot was stopped", () => {
  assert.deepEqual(beyondDirections(297, 2), { left: false, right: true, up: false, down: false });
  assert.deepEqual(beyondDirections(-60, 0.06), { left: true, right: false, up: false, down: true });
  assert.deepEqual(beyondDirections(10, 23.69), { left: false, right: false, up: true, down: false });
  assert.deepEqual(beyondDirections(10, 5.74), { left: false, right: false, up: false, down: false });
  assert.deepEqual(beyondDirections(10, 1), { left: false, right: false, up: false, down: false });
});

test("crowded labels are moved apart so that none covers another, and the tapped one keeps its place", () => {
  const inputs = ["NVDA", "AMD", "INTC", "QCOM", "AMAT", "LRCX", "MU"].map((id, i) => ({ id, x: 150 + (i % 3), y: 100 + (i % 2), r: 6.5, w: 30 }));
  const boxes = placeLabels(inputs, { left: 0, top: 0, right: 340, bottom: 300 }, 11, [], "AMAT");
  const list = Object.values(boxes);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${i} and ${j} overlap`);
  }
  assert.equal(boxes.AMAT.shifted, false);
});

// Nov 24 (owner: "財務レーダーの順位外もできればどうにかしてほしい"): no separate 要確認 block. Prepayments of years ahead are taken out
// before this point (radar-facts.ts); a value still above 100% is ranked with its score stopped at the chart's edge and says why.
test("every company with revenue is ranked: earning power above 100% counts as the chart's edge and is marked", () => {
  const entries = [
    { ticker: "A", facts: { latest: snap("2026-06-30", 40, 2), previous: null } },
    { ticker: "B", facts: { latest: snap("2026-06-30", 297, 0.7), previous: null } },
    { ticker: "C", facts: { latest: snap("2026-06-30", 100, 1.2), previous: null } },
    { ticker: "D", facts: { latest: snap("2026-06-30", 20, 0.5), previous: null } },
  ];
  const pro = buildRadar("semis", entries, "pro");
  assert.deepEqual(pro.dots.map(d => [d.ticker, d.rank, d.review]), [["A", 2, false], ["B", 3, true], ["C", 1, false], ["D", 4, false]]);
  assert.equal(pro.dots.find(d => d.ticker === "B").score, fitnessScore(60, 0.7));
  assert.equal(pro.dots.length, 4);
  assert.ok(!JSON.stringify(buildRadar("semis", entries, "free").dots).includes("review"));
});

test("a company whose prepayments were taken out is ranked and marked; FREE is not told", () => {
  const entries = [
    { ticker: "NBIS", facts: { latest: { ...snap("2026-09-30", -16.4, 0.47), prepaid: true }, previous: null } },
    { ticker: "CRWV", facts: { latest: snap("2026-09-30", 73, 0.06), previous: null } },
  ];
  const pro = buildRadar("ai-cloud", entries, "pro");
  assert.deepEqual(pro.dots.map(d => [d.ticker, d.rank, d.review, d.prepaid ?? false]), [["NBIS", 2, false, true], ["CRWV", 1, false, false]]);
  assert.ok(!JSON.stringify(buildRadar("ai-cloud", entries, "free").dots).includes("prepaid"));
});

test("dots stopped at an edge that land on each other are spread so both show; dots inside keep their place", () => {
  const bounds = { left: 46, top: 10, right: 330, bottom: 282 };
  const dots = [
    { id: "IREN", x: 320, y: 200, r: 6.5, edgeX: true, edgeY: false },
    { id: "NBIS", x: 320, y: 202, r: 6.5, edgeX: true, edgeY: false },
    { id: "MID", x: 150, y: 120, r: 6.5, edgeX: false, edgeY: false },
    { id: "TOP", x: 200, y: 14, r: 4.5, edgeX: false, edgeY: true },
    { id: "TOP2", x: 203, y: 14, r: 4.5, edgeX: false, edgeY: true },
  ];
  const at = spreadEdgeDots(dots, bounds);
  assert.ok(Math.hypot(at.IREN.x - at.NBIS.x, at.IREN.y - at.NBIS.y) >= 13);
  assert.equal(at.IREN.x, 320); assert.equal(at.NBIS.x, 320);   // they slide along the edge
  assert.ok(Math.hypot(at.TOP.x - at.TOP2.x, at.TOP.y - at.TOP2.y) >= 9);
  assert.equal(at.TOP.y, 14);
  assert.deepEqual(at.MID, { x: 150, y: 120 });
  for (const dot of dots) { const p = at[dot.id]; assert.ok(p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.top && p.y <= bounds.bottom); }
  // a free dot beside an edge dot: only the edge dot moves
  const near = spreadEdgeDots([{ id: "E", x: 320, y: 100, r: 6.5, edgeX: true, edgeY: false }, { id: "F", x: 316, y: 101, r: 6.5, edgeX: false, edgeY: false }], bounds);
  assert.deepEqual(near.F, { x: 316, y: 101 });
  assert.ok(Math.hypot(near.E.x - near.F.x, near.E.y - near.F.y) >= 13);
});

test("PRO rank places: the same places as FREE, ranks from the top, zones from the chart, previous earnings ranked among themselves (owner, Nov 26)", () => {
  const snapG = (end, ocf, cover) => snap(end, ocf, cover);
  const entries = [
    { ticker: "A", facts: { latest: snapG("2026-06-30", 70, 0.1), previous: snapG("2026-03-31", 10, 0.2) } },
    { ticker: "B", facts: { latest: snapG("2026-06-30", -20, 0.5), previous: snapG("2026-03-31", -40, 0.1) } },
    { ticker: "C", facts: { latest: snapG("2026-06-30", 30, 0.4), previous: snapG("2026-03-31", 50, 3) } },
    { ticker: "D", facts: { latest: snapG("2026-06-30", -200, 0.9), previous: null } },
    { ticker: "E", facts: { latest: snapG("2026-06-30", 30, 0.4), previous: snapG("2026-03-31", 20, 0.3) } },
  ];
  const free = buildRadar("ai-cloud", entries, "free"), pro = buildRadar("ai-cloud", entries, "pro");
  const { count, places } = proRankPlaces(pro.dots);
  assert.equal(count, 5);
  for (const dot of free.dots) { assert.equal(places[dot.ticker].x, dot.x); assert.equal(places[dot.ticker].y, dot.y); }
  // earning power: A 70 > C 30 = E 30 (tie: genre order, C below E) > B -20 > D -200
  assert.deepEqual(["A", "B", "C", "D", "E"].map(t => places[t].earnRank), [1, 4, 3, 5, 2]);
  assert.deepEqual(["A", "B", "C", "D", "E"].map(t => places[t].coverRank), [5, 2, 4, 1, 3]);
  // ranks read the same as the order on the chart
  const byX = Object.entries(places).sort((a, b) => b[1].x - a[1].x).map(([t]) => t);
  for (const [i, t] of byX.entries()) assert.equal(places[t].earnRank, i + 1);
  for (const [t, place] of Object.entries(places)) assert.equal(place.zone, zoneAt(place.x, place.y), t);
  assert.equal(places.A.zone, "lever"); assert.equal(places.D.zone, "guard");
  // previous: ranked among the four previous values only (never mixed with the latest); D has none
  assert.equal(places.D.previous, null);
  assert.deepEqual(["A", "B", "C", "E"].map(t => places[t].previous.x), [0.375, 0.125, 0.875, 0.625]);
  assert.deepEqual(["A", "B", "C", "E"].map(t => places[t].previous.y), [0.375, 0.125, 0.875, 0.625]);
  // moves among those four: earning now A1 E2 C3 B4, then C1 E2 A3 B4 → A up 2, C down 2, E and B unchanged
  assert.deepEqual(["A", "B", "C", "E"].map(t => places[t].previous.earnMove), [2, 0, -2, 0]);
  // cover now B1 E2 C3 A4 (C ties E: genre order puts C lower), then C1 E2 A3 B4 → B up 3, C down 2, E unchanged, A down 1
  assert.deepEqual(["A", "B", "C", "E"].map(t => places[t].previous.coverMove), [-1, 3, -2, 0]);
  assert.equal(zoneAt(0.5, 0.5), "solid"); assert.equal(zoneAt(0.49, 0.49), "thin");
});
