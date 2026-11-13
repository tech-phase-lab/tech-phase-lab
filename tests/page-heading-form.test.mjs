import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every page heading uses the watchlist's form: English small capitals over a 26px title", () => {
  const css = read("app/research/page-heading.module.css");
  assert.match(css, /\.eyebrow \{ margin:0; font-size:11px; font-weight:600; line-height:1\.3; letter-spacing:\.16em; color:#8e9aaa; \}/);
  assert.match(css, /header\.head h1 \{ margin:0; font-size:26px; font-weight:700;/);
  assert.match(read("app/research/research-tool-shell.tsx"), /eyebrow \? <PageHeading eyebrow=\{eyebrow\}/);
  const pages = { "app/research/market/page.tsx": "MARKET", "app/research/news/page.tsx": "TECH ALERTS", "app/research/general-news/page.tsx": "GENERAL NEWS",
    "app/research/calendar/event-calendar.tsx": "CALENDAR", "app/research/faq/faq.tsx": "FAQ", "app/research/learn/guide.tsx": "GETTING STARTED",
    "app/research/price-targets/page.tsx": "PRICE TARGETS", "app/research/account/screen.tsx": "MY ACCOUNT", "app/research/account/billing/screen.tsx": "PRO MEMBERSHIP" };
  for (const [file, name] of Object.entries(pages)) assert.match(read(file), new RegExp(`eyebrow="${name}"`), file);
  for (const file of ["app/research/notebook/screen.module.css", "app/research/radar/radar.module.css", "app/research/notification-page.module.css", "app/research/portfolio/portfolio.module.css"]) {
    const source = read(file);
    assert.match(source, /letter-spacing: ?\.16em; ?color: ?#8e9aaa/, file);
    assert.match(source, /font-size: ?26px/, file);
  }
});
