import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHEAP_FROM, aboutText, footerLine, growth, monthDay, parseValueSnapshot, periodNote, ratio, stockHref, valueCheckAccess, valueCheckEnabled } from "../lib/research/value-check.ts";

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
  const parsed = parseValueSnapshot({ ...good, universes: { ...good.universes, tech: { ...good.universes.tech, items: [{ ...good.universes.tech.items[0], low: true, period: "listed", previous: -12 }, good.universes.tech.items[1]] } } });
  assert.equal(parsed.universes.tech.items[0].low, true);
  assert.equal(parsed.universes.tech.items[0].period, "listed");
  assert.equal(parsed.universes.tech.items[0].previous, -12);
  assert.equal(parsed.universes.tech.items[1].low, false);
  assert.equal(parsed.universes.tech.items[0].ticker, "MU");
  assert.equal(parsed.universes.tech.items[1].pe, null);
  assert.throws(() => parseValueSnapshot({ ...good, universes: { ...good.universes, tech: list([row("A", 50), row("B", 80)]) } }));
  assert.throws(() => parseValueSnapshot({ ...good, universes: { ...good.universes, tech: list([row("<x>", 50)]) } }));
  assert.throws(() => parseValueSnapshot({ ok: false }));
});

test("copy: owner's wording, 実績値 for the trailing history, no advice words, no punctuation right after a closing parenthesis", () => {
  assert.equal(footerLine("2026-11-20", "trailing", true), "11/20の終値で更新・PERとPSRは実績値・売上は前年比");
  assert.equal(footerLine("2026-11-21", "forward", true), "11/21の終値で更新・PERとPSRは予想値・売上は前年比");
  assert.equal(aboutText("forward", true), "割安度は、予想PERと予想PSRが、その銘柄の過去5年の平均と比べてどれだけ低いかを%で表したものです。数字が大きいほど、5年平均より安い位置にあります。「5年最安」は、過去5年で一番安い水準にある銘柄です。赤字の銘柄、PERが100倍を超える銘柄、売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。");
  assert.equal(aboutText("trailing", true), "割安度は、PERとPSRが、その銘柄の過去5年の平均と比べてどれだけ低いかを%で表したものです。数字が大きいほど、5年平均より安い位置にあります。「5年最安」は、過去5年で一番安い水準にある銘柄です。赤字の銘柄、PERが100倍を超える銘柄、売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。");
  assert.equal(aboutText("forward", false), "The Value Score shows how far a stock's forward P/E and forward P/S are below their own five-year averages. The higher the number, the cheaper it is compared with its five-year average. \"5Y Low\" marks stocks at their lowest level in five years. Loss-making stocks, stocks with a P/E above 100 and stocks with falling year-over-year revenue are excluded. Updated daily at the close.");
  assert.equal(aboutText("trailing", false), "The Value Score shows how far a stock's P/E and P/S are below their own five-year averages. The higher the number, the cheaper it is compared with its five-year average. \"5Y Low\" marks stocks at their lowest level in five years. Loss-making stocks, stocks with a P/E above 100 and stocks with falling year-over-year revenue are excluded. Updated daily at the close.");
  assert.doesNotMatch(aboutText("trailing", false), /forward/);
  const screen = readFileSync(new URL("../app/research/treasure-hunt/screen.tsx", import.meta.url), "utf8");
  for (const source of [screen, aboutText("trailing", true), footerLine("2026-11-20", "trailing", true)]) {
    assert.doesNotMatch(source, /買い|おすすめ|オススメ|チャンス|狙い目|NEW/);
    assert.doesNotMatch(source, /）[、。・]/);
  }
  assert.equal(monthDay("2026-11-05"), "11/5");
  // English view (Nov 22 review): US multiples names, "Nov 20" dates, no Japanese punctuation or labels.
  assert.equal(monthDay("2026-11-05", false), "Nov 5");
  assert.equal(footerLine("2026-11-20", "trailing", false), "As of Nov 20 close · Trailing P/E and P/S · Revenue growth YoY");
  assert.equal(periodNote("data", false), "Based on available filings");
  assert.match(screen, /: `P\/E \$\{ratio\(item\.pe\)\} · P\/S \$\{ratio\(item\.ps\)\}`/);
  const english = [...screen.matchAll(/t\("[^"]*", "([^"]*)"\)/g)].map(match => match[1]).join("\n") + footerLine("2026-11-20", "trailing", false) + aboutText("trailing", false);
  assert.doesNotMatch(english, /[　-ヿ一-鿿＀-￯]|PER|PSR/);
  assert.doesNotMatch(english, /\b(buys?|recommend\w*|opportunit\w*|bargain\w*)\b/i);
  assert.equal(ratio(null), "—");
  assert.equal(ratio(3.84), "3.8");
  assert.equal(growth(190), "+190%");
  assert.equal(stockHref("MU"), "/research/stocks?q=MU");
  assert.equal(CHEAP_FROM, 30);
  assert.equal(periodNote("listed", true), "上場後の期間で計算");
  assert.equal(periodNote(null, true), null);
  // 5年最安 comes after IN, as an outline (IN is filled)
  assert.match(screen, /\{item\.in && <i className=\{styles\.inMini\}>IN<\/i>\}\n\s*\{item\.low && <i className=\{styles\.lowMini\}>\{ja \? "5年最安" : "5Y Low"\}<\/i>\}/);
});

test("menu: PRO members get the 2x3 frame with Treasure Hunt and Whale Tracks; 財務レーダー stays under Research (owner, Nov 22 v2)", () => {
  const header = readFileSync(new URL("../app/research/site-header.tsx", import.meta.url), "utf8");
  const tiles = [...header.matchAll(/\{(?:(?:valueCheck|whaleMoves) && )?tile\("([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tiles, ["/research/notes", "/research#monitored-companies", "/research/themes", "/research/treasure-hunt", "/research/compare", "/research/whales"]);
  assert.match(header, /ja \? "トレジャーハント" : "Treasure Hunt"/);
  assert.match(header, /ja \? "クジラの足あと" : "Whale Tracks"/);
  assert.match(header, /\{item\("\/research\/radar"/);
  assert.match(header, /const valueCheck = valueCheckEnabled\(\) \|\| ownerAccount;/);
  // A missing logo shows the whole ticker, never two letters that read as the IN / OUT badge (INTU -> 「IN」).
  const screen = readFileSync(new URL("../app/research/treasure-hunt/screen.tsx", import.meta.url), "utf8");
  assert.equal(screen.match(/<StockLogo [^>]*\bfull\b/g)?.length, 2);
  assert.match(readFileSync(new URL("../app/research/watchlist/stock-logo.tsx", import.meta.url), "utf8"), /full \? <span style=\{fullSize\(ticker\)\}>\{ticker\}<\/span>/);
  const page = readFileSync(new URL("../app/research/treasure-hunt/page.tsx", import.meta.url), "utf8");
  assert.match(page, /notFound\(\)/);
  assert.match(page, /title: "トレジャーハント \| Tech Phase PRO"/);
  const route = readFileSync(new URL("../app/api/research/value-check/route.ts", import.meta.url), "utf8");
  assert.match(route, /valueCheckAccess\(member, valueCheckEnabled\(\)\)/);
});

test("desktop left menu: Treasure Hunt and Whale Tracks sit in the PRO rows in the phone menu's order, behind the same switches (owner, Nov 22)", () => {
  const sidebar = readFileSync(new URL("../app/research/home-sidebar.tsx", import.meta.url), "utf8");
  const start = sidebar.indexOf("const research: Item[]"), end = sidebar.indexOf("const destinations", start);
  const rows = sidebar.slice(start, end);
  const hrefs = [...rows.matchAll(/href: "(\/research\/[^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(hrefs.slice(hrefs.indexOf("/research/themes")), ["/research/themes", "/research/treasure-hunt", "/research/compare", "/research/whales"]);
  // PRO only: both rows live inside the member block, each behind its own switch.
  const memberBlock = rows.slice(rows.indexOf("...(member ? [\n"), rows.lastIndexOf("] : []),"));
  assert.match(memberBlock, /\.\.\.\(valueCheck \? \[\{ key: "value-check", icon: icons\.tag, label: t\("トレジャーハント", "Treasure Hunt"\), href: "\/research\/treasure-hunt" \}\] : \[\]\)/);
  assert.match(memberBlock, /\.\.\.\(whaleMoves \? \[\{ key: "whales", icon: icons\.whale, label: t\("クジラの足あと", "Whale Tracks"\), href: "\/research\/whales" \}\] : \[\]\)/);
  // The owner's accounts always see them (AGENTS.md, operator access); FREE rows are unchanged.
  assert.match(sidebar, /const valueCheck = valueCheckEnabled\(\) \|\| ownerAccount;/);
  assert.match(sidebar, /const whaleMoves = whaleMovesEnabled\(\) \|\| ownerAccount;/);
  assert.match(sidebar, /const member = ownerAccount \|\| plan === "pro"/);
  const quick = sidebar.slice(sidebar.indexOf("const quick: Item[]"), start);
  assert.doesNotMatch(quick + rows.slice(0, rows.indexOf("...(member ? [\n")), /value-check|treasure-hunt|whales/);
});

test("the comparison's list: every calculated ticker is parsed; a bad entry is left out and never breaks Treasure Hunt", async () => {
  const { parseValueSnapshot } = await import("../lib/research/value-check.ts");
  const list = { total: 1, items: [], changes: { in: [], out: [] }, excluded: {} };
  const base = { ok: true, basis: "trailing", asOf: "2026-11-25", computedAt: "2026-11-25T22:40:00Z", universes: { tech: list, all: list } };
  assert.equal(parseValueSnapshot(base).values, undefined, "a snapshot from before Nov 26 has no list");
  const parsed = parseValueSnapshot({ ...base, values: {
    NVDA: { score: 36, exact: 35.8, pe: 40.1, ps: 31.5, peNow: 42.5, psNow: 21.3, basis: "pe-ps", period: null },
    RIVN: { score: -20, exact: -19.6, pe: null, ps: -19.6, peNow: null, psNow: 2.1, basis: "ps", period: "listed" },
    BAD: { score: "x" }, "bad ticker": { score: 1, exact: 1, pe: null, ps: 1, peNow: null, psNow: 1, basis: "ps" },
    HALF: { score: 5, exact: 5, pe: null, ps: 5, peNow: null, psNow: 1, basis: "pe-ps" } } });
  assert.deepEqual(Object.keys(parsed.values), ["NVDA", "RIVN"]);
  assert.deepEqual(parsed.values.RIVN, { score: -20, exact: -19.6, pe: null, ps: -19.6, peNow: null, psNow: 2.1, basis: "ps", period: "listed", asOf: "2026-11-25" });
});
