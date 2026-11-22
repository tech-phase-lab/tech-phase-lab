import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aboutText, footerLine, growth, monthDay, parseValueSnapshot, ratio, stockHref, valueCheckAccess, valueCheckEnabled } from "../lib/research/value-check.ts";

const now = Date.UTC(2026, 10, 22);
const pro = { status: "signed-in", plan: "pro", accessExpiresAt: now + 60_000 };
const owner = { status: "signed-in", plan: "pro", accessExpiresAt: now + 60_000, ownerAccount: true };

test("operator access: the owner's accounts can always use Value Check, even while the switch is off (AGENTS.md)", () => {
  assert.equal(valueCheckAccess(owner, false, now), 200);
  assert.equal(valueCheckAccess(owner, true, now), 200);
  assert.equal(valueCheckAccess({ status: "signed-in", plan: "free", ownerAccount: true }, false, now), 200);
});

test("members: hidden until the owner turns it on, then PRO only", () => {
  assert.equal(valueCheckAccess(pro, false, now), 404);
  assert.equal(valueCheckAccess(pro, true, now), 200);
  assert.equal(valueCheckAccess({ ...pro, accessExpiresAt: now }, true, now), 403);
  assert.equal(valueCheckAccess({ status: "signed-in", plan: "free" }, true, now), 403);
  assert.equal(valueCheckAccess({ status: "signed-out", plan: "free" }, true, now), 401);
  assert.equal(valueCheckAccess({ status: "unavailable", plan: "free" }, true, now), 503);
  assert.equal(valueCheckEnabled({}), false);
  assert.equal(valueCheckEnabled({ NEXT_PUBLIC_VALUE_CHECK_ENABLED: "true" }), true);
});

const list = (items, changes = { in: [], out: [] }) => ({ total: 150, items, changes, excluded: { "revenue-decline": ["INTC"] } });
const row = (ticker, score, extra = {}) => ({ ticker, ja: ticker, en: ticker, score, previous: score, pe: 12.3, ps: 3.4, revenueGrowth: 12, in: false, ...extra });

test("the payload is validated and must already be ranked (no other order can reach the screen)", () => {
  const good = { ok: true, basis: "trailing", asOf: "2026-11-20", computedAt: "2026-11-20T22:40:00Z",
    universes: { tech: list([row("MU", 96, { in: true, previous: 61 }), row("QCOM", 91, { pe: null })], { in: [{ ticker: "MU", from: 61, to: 96 }], out: [] }), all: list([]) } };
  const parsed = parseValueSnapshot(good);
  assert.equal(parsed.universes.tech.items[0].ticker, "MU");
  assert.equal(parsed.universes.tech.items[1].pe, null);
  assert.throws(() => parseValueSnapshot({ ...good, universes: { ...good.universes, tech: list([row("A", 50), row("B", 80)]) } }));
  assert.throws(() => parseValueSnapshot({ ...good, universes: { ...good.universes, tech: list([row("<x>", 50)]) } }));
  assert.throws(() => parseValueSnapshot({ ok: false }));
});

test("copy: owner's wording, 実績値 for the trailing history, no advice words, no punctuation right after a closing parenthesis", () => {
  assert.equal(footerLine("2026-11-20", "trailing", true), "11/20の終値で更新・PERとPSRは実績値・売上は前年比");
  assert.equal(footerLine("2026-11-21", "forward", true), "11/21の終値で更新・PERとPSRは予想値・売上は前年比");
  assert.equal(aboutText("forward", true), "割安度は、予想PERと予想PSRがその銘柄の過去5年の中でどれだけ低い位置にあるかを0〜100%で表したものです。100%に近いほど過去5年の中で安い位置にあります。売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。");
  assert.equal(aboutText("trailing", true), "割安度は、PERとPSRがその銘柄の過去5年の中でどれだけ低い位置にあるかを0〜100%で表したものです。100%に近いほど過去5年の中で安い位置にあります。売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。");
  assert.equal(aboutText("forward", false), "The Value Score shows where a stock's forward P/E and forward P/S sit within its own five-year range, from 0% to 100%. The closer to 100%, the cheaper it is compared with its own past five years. Stocks with falling year-over-year revenue are excluded. Updated daily at the close.");
  assert.doesNotMatch(aboutText("trailing", false), /forward/);
  const screen = readFileSync(new URL("../app/research/value-check/screen.tsx", import.meta.url), "utf8");
  for (const source of [screen, aboutText("trailing", true), footerLine("2026-11-20", "trailing", true)]) {
    assert.doesNotMatch(source, /買い|おすすめ|オススメ|チャンス|狙い目|NEW/);
    assert.doesNotMatch(source, /）[、。・]/);
  }
  assert.equal(monthDay("2026-11-05"), "11/5");
  assert.equal(ratio(null), "—");
  assert.equal(ratio(3.84), "3.8");
  assert.equal(growth(190), "+190%");
  assert.equal(stockHref("MU"), "/research/stocks?q=MU");
});

test("menu: PRO members get the 2x3 frame with Value Check and Financial Radar; FREE keeps the radar under Research", () => {
  const header = readFileSync(new URL("../app/research/site-header.tsx", import.meta.url), "utf8");
  const tiles = [...header.matchAll(/\{(?:valueCheck && )?tile\("([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tiles, ["/research/notes", "/research#monitored-companies", "/research/themes", "/research/value-check", "/research/compare", "/research/radar"]);
  assert.match(header, /ja \? "割安判別ツール" : "Value Check"/);
  assert.match(header, /!\(member && valueCheck\) && item\("\/research\/radar"/);
  assert.match(header, /const valueCheck = valueCheckEnabled\(\) \|\| ownerAccount;/);
  const page = readFileSync(new URL("../app/research/value-check/page.tsx", import.meta.url), "utf8");
  assert.match(page, /notFound\(\)/);
  const route = readFileSync(new URL("../app/api/research/value-check/route.ts", import.meta.url), "utf8");
  assert.match(route, /valueCheckAccess\(member, valueCheckEnabled\(\)\)/);
});
