import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { compactUsd } from "../lib/research/compact-usd.ts";
import { englishTitle } from "../lib/research/english-titles.ts";

// Read-only production QA sweep, Nov 24.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Capital Map: compact amounts are the same on the server and in every browser (hydration error #418)", () => {
  assert.equal(compactUsd(65_950_296_923, "ja"), "$659.5億");
  assert.equal(compactUsd(65_950_296_923, "en"), "$65.95B");
  assert.equal(compactUsd(1_234_000_000_000, "ja"), "$1.23兆");
  assert.equal(compactUsd(12_000, "ja"), "$1.2万");
  assert.equal(compactUsd(999_999, "en"), "$1M");
  assert.equal(compactUsd(950, "en"), "$950");
  assert.equal(compactUsd(-2_500_000, "en"), "-$2.5M");
  const screen = read("app/research/capital-map/screen.tsx");
  // No ICU-dependent compact notation, no locale-less number formatting, and one text node per SVG <title>.
  assert.doesNotMatch(screen, /notation: "compact"/);
  assert.doesNotMatch(screen, /toLocaleString\(\)/);
  assert.doesNotMatch(screen, /<title>\{[^`][^<]*\}[^<]+</);
});

test("browser-tab titles and the default description", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /title: "Tech Phase Research",/);
  assert.doesNotMatch(layout, /Research Lab|prototype/);
  assert.match(layout, /description: "米国ハイテク株の/);
  assert.doesNotMatch(read("app/research/page.tsx"), /Research preview/);
  const titles = { market: "マーケット", news: "ハイテク速報", "general-news": "注目トピック", "price-targets": "目標株価", notifications: "スマホ通知" };
  for (const [dir, ja] of Object.entries(titles)) assert.match(read(`app/research/${dir}/layout.tsx`), new RegExp(`title: "${ja} \\| Tech Phase Research"`), dir);
  assert.match(read("app/research/columns/page.tsx"), /title: "RIZEL’S DESK \| Tech Phase Research"/);
  assert.match(read("app/research/notes/page.tsx"), /title: "リゼルのひとりごと \| Tech Phase Research"/);
  for (const path of ["/research", "/research/market", "/research/news", "/research/general-news", "/research/price-targets", "/research/columns", "/research/notes", "/research/notifications"]) assert.ok(englishTitle(path), path);
});

test("custom 404 page in Japanese and English, leading home", () => {
  assert.ok(existsSync(new URL("../app/not-found.tsx", import.meta.url)));
  const view = read("app/not-found-view.tsx");
  assert.match(view, /ページが見つかりません/);
  assert.match(view, /Page not found/);
  assert.match(view, /href="\/research"/);
});

test("robots.txt keeps crawlers off the APIs and operator pages only, and lists no sitemap (most pages are noindex on purpose)", async () => {
  const source = read("app/robots.ts");
  assert.doesNotMatch(source, /^\s*sitemap:/m);
  for (const path of ["/api/", "/research/review", "/research/editorial", "/research/questions", "/research/intake"]) assert.ok(source.includes(`"${path}"`), path);
  // Public pages stay crawlable so their own noindex can be read.
  assert.match(source, /allow: "\/"/);
});

test("signed-out pages do not call member-only APIs", () => {
  assert.match(read("app/research/identity-provider.tsx"), /export function useIdentitySignedIn\(\)/);
  for (const path of ["app/research/watchlist/use-favorite-lists.ts", "app/research/use-saved-research.ts", "app/research/deep-analysis-panel.tsx"]) {
    const source = read(path);
    assert.match(source, /const signedIn = useIdentitySignedIn\(\);/, path);
    assert.match(source, /if \(signedIn !== true\) return;/, path);
    assert.match(source, /\}, \[signedIn\]\);/, path);
  }
});
