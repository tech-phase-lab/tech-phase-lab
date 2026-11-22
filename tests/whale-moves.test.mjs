import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ABOUT, asOfLine, filterInsiders, money, parseWhaleSnapshot, quarterLabel, roleLabel, signedPoints, sortBuybacks, sortInstitutions, sortShort,
  whaleMovesAccess, whaleMovesEnabled, monthDay, SORTS, WHALE_TABS } from "../lib/research/whale-moves.ts";

const now = Date.UTC(2026, 10, 22);
const pro = { status: "signed-in", plan: "pro", accessExpiresAt: now + 60_000 };
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("operator access: the owner's accounts can always open クジラの足あと, even while the switch is off (AGENTS.md)", () => {
  assert.equal(whaleMovesAccess({ ...pro, ownerAccount: true }, false, now), 200);
  assert.equal(whaleMovesAccess({ status: "signed-in", plan: "free", ownerAccount: true }, false, now), 200);
  assert.equal(whaleMovesAccess({ status: "signed-in", plan: "free", ownerMode: true }, true, now), 200);
});

test("members: hidden until the owner turns it on, then PRO only", () => {
  assert.equal(whaleMovesEnabled({}), false);
  assert.equal(whaleMovesEnabled({ NEXT_PUBLIC_WHALE_MOVES_ENABLED: "true" }), true);
  assert.equal(whaleMovesAccess(pro, false, now), 404);
  assert.equal(whaleMovesAccess(pro, true, now), 200);
  assert.equal(whaleMovesAccess({ ...pro, accessExpiresAt: now }, true, now), 403);
  assert.equal(whaleMovesAccess({ status: "signed-in", plan: "free" }, true, now), 403);
  assert.equal(whaleMovesAccess({ status: "signed-out", plan: "free" }, true, now), 401);
  assert.equal(whaleMovesAccess({ status: "unavailable", plan: "free" }, true, now), 503);
});

const snapshot = {
  ok: true, institutionalAsOf: "2026-06-30", shortAsOf: "2026-11-14",
  institutional: [
    { ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA", pct: 69.68, change: 3.14, holders: 5956, holdersChange: 186 },
    { ticker: "SWKS", ja: "スカイワークス", en: "Skyworks", pct: 121.94, change: -2.5, holders: 900, holdersChange: -3 },
    { ticker: "MU", ja: "マイクロン", en: "Micron", pct: 77.69, change: 3.04, holders: 3888, holdersChange: 918 },
  ],
  short: [{ ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA", pct: 1.16, change: -0.09, days: 2.8 }, { ticker: "MU", ja: "マイクロン", en: "Micron", pct: 2.07, change: 0.08, days: null }],
  insiders: [
    { ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA", date: "2026-09-18", role: "Director", side: "sell", planned: false, value: 297942896.4 },
    { ticker: "MU", ja: "マイクロン", en: "Micron", date: "2026-10-16", role: "Pres. & Chief Tech & Prod Offr", side: "buy", planned: true, value: 4200000 },
  ],
  buybacks: [
    { ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA", kind: "quarter", date: "2026-08-26", start: "2026-04-27", end: "2026-07-26", amount: 19732000000 },
    { ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA", kind: "authorization", date: "2026-11-17", amount: 150000000000 },
  ],
};

test("the payload is validated; a bad ticker or a missing list never reaches the screen", () => {
  const data = parseWhaleSnapshot(snapshot);
  assert.equal(data.institutional.length, 3);
  assert.throws(() => parseWhaleSnapshot({ ...snapshot, short: [{ ...snapshot.short[0], ticker: "<b>" }] }));
  assert.throws(() => parseWhaleSnapshot({ ...snapshot, insiders: null }));
  assert.throws(() => parseWhaleSnapshot({ ok: false }));
});

test("sorting: over-100% stocks sort by their real value; insiders newest first; buybacks by date or amount", () => {
  const data = parseWhaleSnapshot(snapshot);
  assert.deepEqual(sortInstitutions(data.institutional, "up").map(r => r.ticker), ["NVDA", "MU", "SWKS"]);
  assert.deepEqual(sortInstitutions(data.institutional, "down").map(r => r.ticker), ["SWKS", "MU", "NVDA"]);
  assert.deepEqual(sortInstitutions(data.institutional, "high").map(r => r.ticker), ["SWKS", "MU", "NVDA"]);
  assert.deepEqual(sortShort(data.short, "high").map(r => r.ticker), ["MU", "NVDA"]);
  assert.deepEqual(sortShort(data.short, "days").map(r => r.ticker), ["NVDA", "MU"]);
  assert.deepEqual(filterInsiders(data.insiders, "all").map(r => r.ticker), ["MU", "NVDA"]);
  assert.deepEqual(filterInsiders(data.insiders, "sell").map(r => r.ticker), ["NVDA"]);
  assert.deepEqual(sortBuybacks(data.buybacks, "new").map(r => r.kind), ["authorization", "quarter"]);
});

test("amounts in Japanese units and short English units (owner's sheet)", () => {
  assert.equal(money(297942896.4, true), "2.98億ドル");
  assert.equal(money(4200000, true), "420万ドル");
  assert.equal(money(110000000000, true), "1,100億ドル");
  assert.equal(money(14200000000, true), "142億ドル");
  assert.equal(money(297942896.4, false), "$298M");
  assert.equal(money(4200000, false), "$4.2M");
  assert.equal(money(110000000000, false), "$110B");
  assert.equal(signedPoints(3.14), "+3.1pt");
  assert.equal(signedPoints(-0.09, 2), "−0.09pt");
  assert.equal(signedPoints(0.04), "±0.0pt");
  assert.equal(signedPoints(3.14, 1, false), "+3.1 pts");
  assert.equal(signedPoints(-0.09, 2, false), "−0.09 pts");
});

test("labels: quarter months, officer titles, the as-of line and the owner's i text", () => {
  assert.equal(quarterLabel("2026-09-30", true), "7〜9月");
  assert.equal(quarterLabel("2026-07-26", true), "5〜7月");
  assert.equal(quarterLabel("2026-01-04", true), "10〜12月");
  assert.equal(roleLabel("Director", true), "取締役");
  assert.equal(roleLabel("EVP & Chief Financial Officer", true), "CFO");
  assert.equal(roleLabel("President and Chief Executive Officer, Director", true), "CEO・取締役");
  const data = parseWhaleSnapshot(snapshot);
  assert.equal(asOfLine("institutions", data, true), "6月末時点・13F（四半期ごとに更新）");
  assert.equal(asOfLine("short", data, true), "11月14日時点・FINRA（月2回更新）");
  assert.match(ABOUT.institutions.ja, /100%を超える銘柄があります。$/);
  // English view (Nov 22 review): "Nov 14" dates, no Japanese text, no advice words in labels.
  assert.equal(quarterLabel("2026-09-30", false), "Jul–Sep");
  assert.equal(monthDay("2026-11-14", false), "Nov 14");
  assert.equal(asOfLine("institutions", data, false), "As of end-Jun · 13F (updated quarterly)");
  assert.equal(asOfLine("short", data, false), "As of Nov 14 · FINRA (updated twice a month)");
  assert.equal(roleLabel("President and Chief Executive Officer, Director", false), "CEO · Director");
  const screen = read("../app/research/whales/screen.tsx");
  const labels = [...WHALE_TABS, ...Object.values(SORTS).flat()].map(item => item.en);
  const english = [...labels, ...Object.values(ABOUT).map(item => item.en), ...[...screen.matchAll(/t\("[^"]*", "([^"]*)"\)/g)].map(match => match[1]),
    ...(["institutions", "short", "insiders", "buybacks"].map(tab => asOfLine(tab, data, false)))].join("\n");
  assert.doesNotMatch(english, /[　-ヿ一-鿿＀-￯]/);
  assert.doesNotMatch(labels.join("\n"), /\b(buys?|recommend\w*|opportunit\w*|bargain\w*)\b/i);
  assert.match(screen, /\(ja \? "買い" : "Bought"\) : \(ja \? "売り" : "Sold"\)/);
});

test("no advice words and no institution lists on the page (owner's rules)", () => {
  const screen = read("../app/research/whales/screen.tsx") + read("../lib/research/whale-moves.ts");
  for (const word of ["おすすめ", "チャンス", "狙い目", "NEW"]) assert.ok(!screen.includes(word), word);
  assert.ok(!/filer|holderName|institutionName/i.test(screen));
});

test("menu: PRO tiles in the owner's order, クジラの足あと behind its switch, 財務レーダー under Research", () => {
  const header = read("../app/research/site-header.tsx");
  const tiles = header.slice(header.indexOf('tile("/research/notes"'), header.indexOf('heading(ja ? "リサーチ"'));
  const order = ["/research/notes", "/research#monitored-companies", "/research/themes", "/research/value-check", "/research/compare", "/research/whales"].map(h => tiles.indexOf(`"${h}"`));
  assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), String(order));
  assert.match(tiles, /\{whaleMoves && tile\("\/research\/whales", "whale"/);
  assert.match(header, /const whaleMoves = whaleMovesEnabled\(\) \|\| ownerAccount;/);
  assert.match(read("../proxy.ts"), /"\/api\/research\/whales"/);
});
