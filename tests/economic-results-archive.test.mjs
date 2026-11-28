// Every stored indicator result reaches the calendar (Nov 28): not only the news feed's newest 20 and seven days of BLS/BEA headlines.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { parseArchive, withArchive } from "../lib/research/economic-results-archive.ts";
import { releaseView } from "../lib/research/economic-release-view.ts";

const calendarUrl = new URL("../lib/research/calendar.ts", import.meta.url).href;
const source = (await readFile(new URL("../lib/research/pce-results.ts", import.meta.url), "utf8")).replace('"./calendar"', JSON.stringify(calendarUrl));
const { mergeEconomicResults } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));

const stored = (id, releasedAt, resultJa, resultEn, publisher, url, extra = {}) => ({ id, titleJa: `${id}（12月）`, titleEn: id, sourceName: publisher, releasedAt, resultJa, resultEn,
  detailJa: "公式発表から取得。", detailEn: "From the official release.", sourceUrl: url, sources: [{ publisher, title: "release", url }], verifiedOn: releasedAt.slice(0, 10), archived: "official", ...extra });
const cpiDec = stored("cpi-2026-12", "2027-01-13T13:30:00+00:00", "米国12月CPI：総合 前月比+0.3%・前年比+3.9%", "U.S. December CPI: headline +0.3% MoM / +3.9% YoY", "BLS", "https://www.bls.gov/news.release/archives/cpi_01132027.htm",
  { titleJa: "米国CPI（消費者物価指数）（12月）", titleEn: "U.S. Consumer Price Index (2026-12)" });
const claims = Array.from({ length: 25 }, (_, i) => stored(`claims-2026-${String(10 + Math.floor(i / 5)).padStart(2, "0")}-0${(i % 5) + 1}`, new Date(Date.UTC(2026, 9, 1 + i * 3, 13, 30)).toISOString(), "200,000件", "200,000", "U.S. Department of Labor", "https://www.dol.gov/ui/data.pdf"));

test("the monitor's answer is checked row by row, beyond the feed's 20, and a BLS row with its one official source passes", () => {
  const parsed = parseArchive([cpiDec, ...claims, { id: "BAD ID" }, null]);
  assert.equal(parsed.length, 26, "26 good rows: no limit of 20, the bad ones left out");
  assert.equal(parsed[0].sourceUrl, cpiDec.sourceUrl);
  assert.deepEqual(parseArchive("x"), []);
  assert.deepEqual(parseArchive([{ ...cpiDec, sources: [{ publisher: "Some blog", title: "t", url: cpiDec.sourceUrl }] }]), [], "one source is enough only for an official publisher");
});

test("a stored result replaces the hand-kept row of the same id, and an older stored release comes back after the feed dropped it", () => {
  const live = [stored("claims-2026-11-21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）", "189,000 (down 13,000 from the previous week's revised level)", "U.S. Department of Labor", "https://www.dol.gov/ui/data.pdf")];
  const ppiOct = stored("ppi-2026-10", "2026-11-13T13:30:00+00:00", "米国10月PPI：総合 前月比+0.3%・前年比+6.5%／コア 前月比+0.5%・前年比+4.9%", "U.S. October PPI: final demand +0.3% MoM / +6.5% YoY; core +0.5% MoM / +4.9% YoY", "BLS", "https://www.bls.gov/news.release/archives/ppi_11132026.htm",
    { titleJa: "米国PPI（生産者物価指数）（10月）", titleEn: "U.S. Producer Price Index (2026-10)" });
  const events = withArchive(live, parseArchive([{ ...live[0], resultJa: "old" }, ppiOct, cpiDec]));
  assert.equal(events.find(item => item.id === "claims-2026-11-21").resultJa, live[0].resultJa, "the live feed's copy wins");
  const rows = mergeEconomicResults([], [], events);
  const ppi = rows.find(row => row.id === "ppi-2026-10");
  assert.equal(ppi.result.ja, ppiOct.resultJa, "the stored official result, not the hand-kept fallback");
  assert.equal(rows.filter(row => row.id === "ppi-2026-10").length, 1);
  const view = releaseView(ppi, rows, [], [], Date.parse("2026-11-28T12:00:00Z"), "ja");
  assert.deepEqual([view.display, view.previous.display], ["+0.3%", "+1.4%"], "September as revised in the October release");
  assert.ok(rows.some(row => row.id === "cpi-2026-12"), "a release long out of the news feed is still a row");
  assert.ok(rows.some(row => row.id === "cpi-2026-10"), "without a stored result the hand-kept row stays as the fallback");
});

test("the calendar reads the stored results, and the route answers the same for everyone", async () => {
  const panel = await readFile(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /fetch\("\/api\/research\/economic-results"/);
  assert.match(panel, /const allEconomic = mergeEconomicResults\(updates, briefs, allEvents\);/);
  const route = await readFile(new URL("../app/api/research/economic-results/route.ts", import.meta.url), "utf8");
  assert.match(route, /s-maxage=120/);
  const server = await readFile(new URL("../lib/research/economic-results-server.ts", import.meta.url), "utf8");
  assert.match(server, /import "server-only";/);
  assert.match(server, /readMonitor\("economic-results"/);
});
