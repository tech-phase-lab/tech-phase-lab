// Owner, Nov 22: トレジャーハント showed SEC legal names ("HUBSPOT INC") and English names with suffixes in the Japanese column. Both lists
// now take one display name per ticker from the site's own name lists (Theme Ranking, stock search, the Wikidata directory), resolved on the server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanEnglishName, companyDisplayName, valueSnapshotWithNames, whaleSnapshotWithNames } from "../lib/research/company-display-names.ts";
import { treasureHuntSample } from "../lib/research/pro-experience-sample-treasure.ts";
import { whaleTracksSample } from "../lib/research/pro-experience-sample-whales.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const universe = JSON.parse(read("../lib/research/value-check-universe.json"));
const theme = JSON.parse(read("../lib/research/theme-stock-names.json"));
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const LEGAL = /(?:^|[\s,])(?:Inc|Incorporated|Corp|Corporation|Ltd|plc|N\.V)\.?$/i;
const all = Object.keys(universe.companies).map(ticker => ({ ticker, ...companyDisplayName(ticker) }));

test("English names: suffixes go, capitals become the company's spelling, acronyms stay", () => {
  assert.equal(cleanEnglishName("HUBSPOT INC"), "Hubspot");
  assert.equal(cleanEnglishName("Insulet Corporation"), "Insulet");
  assert.equal(cleanEnglishName("Trade Desk, Inc."), "Trade Desk");
  assert.equal(cleanEnglishName("MACOM Technology Solutions Holdings, Inc."), "MACOM Technology Solutions");
  assert.equal(cleanEnglishName("Walt Disney Company (The)"), "Walt Disney");
  assert.equal(cleanEnglishName("The Allstate Corporation"), "Allstate");
  assert.equal(cleanEnglishName("Alphabet Inc. (Class A)"), "Alphabet");
  assert.equal(cleanEnglishName("DIODES INC /DEL/"), "Diodes");
  assert.equal(cleanEnglishName("AEHR TEST SYSTEMS"), "Aehr Test Systems");
  assert.equal(cleanEnglishName("Deere & Company"), "Deere");
  assert.equal(cleanEnglishName("KKR & Co."), "KKR");
  for (const kept of ["IBM", "IQVIA", "3M", "NVIDIA", "Booking Holdings", "CME Group", "Southern Company"]) assert.equal(cleanEnglishName(kept), kept);
});

test("every universe ticker: no all-capital legal name, no legal suffix, no parenthesis in either language", () => {
  for (const { ticker, ja, en } of all) {
    for (const name of [ja, en].filter(name => name !== "News Corp")) { // the company's name, not a suffix
      assert.ok(name && name.length <= 120, `${ticker} ${name}`);
      assert.doesNotMatch(name, LEGAL, `${ticker} ${name}`);
      assert.doesNotMatch(name, /[(（]/, `${ticker} ${name}`);
      assert.doesNotMatch(name, /\b(?:INC|CORP|LTD|PLC)\b/, `${ticker} ${name}`);
      assert.ok(!(/\s/.test(name) && /[A-Z]{4,}/.test(name) && !/[a-z]/.test(name)), `${ticker} all capitals: ${name}`);
    }
  }
});

test("Japanese names come from the site's maps; Latin names in the map stay Latin; nothing else gets katakana", () => {
  const byTicker = Object.fromEntries(all.map(r => [r.ticker, r]));
  assert.deepEqual(byTicker.NVDA, { ticker: "NVDA", ja: "エヌビディア", en: "NVIDIA" });
  assert.equal(byTicker.MSFT.ja, theme.MSFT.ja);
  assert.equal(byTicker.TSM.ja, theme.TSM.ja);
  assert.equal(byTicker.AMD.ja, "AMD"); // the map's "AMD社" without the 社
  assert.equal(byTicker.T.ja, "AT&T");
  assert.equal(byTicker.GOOGL.ja, "アルファベット"); // stock search's spelling
  assert.equal(byTicker.GOOG.ja, "アルファベット");
  assert.deepEqual(byTicker.HUBS, { ticker: "HUBS", ja: "HubSpot", en: "HubSpot" });
  assert.deepEqual(byTicker.PODD, { ticker: "PODD", ja: "Insulet", en: "Insulet" });
  assert.deepEqual(byTicker.TTD, { ticker: "TTD", ja: "Trade Desk", en: "Trade Desk" });
  assert.equal(byTicker.FIS.ja, "Fidelity National Information Services");
  assert.deepEqual(byTicker.IBM, { ticker: "IBM", ja: "IBM", en: "IBM" });
  // Relationship-map names for one business are not the company's name.
  assert.deepEqual(byTicker.PSA, { ticker: "PSA", ja: "パブリック・ストレージ", en: "Public Storage" });
  assert.equal(byTicker.UNH.en, "UnitedHealth Group");
  assert.equal(byTicker.ABT.en, "Abbott Laboratories");
  // Wikidata labels that name a former company fall back to English.
  assert.deepEqual(byTicker.TT, { ticker: "TT", ja: "Trane Technologies", en: "Trane Technologies" });
  assert.equal(byTicker.NFLX.ja, "ネットフリックス");
  // Every theme ticker in the universe shows the map's Japanese name unless the map entry is one business inside the company.
  for (const r of all) if (theme[r.ticker] && !/[(（]/.test(theme[r.ticker].ja) && !["ABT", "OXY", "CFG"].includes(r.ticker))
    assert.equal(r.ja, theme[r.ticker].ja.replace(/(?<=[A-Za-z0-9])社$/, ""), r.ticker);
  // A ticker none of the lists knows keeps its cleaned English name in Japanese too.
  for (const r of all) if (!JAPANESE.test(r.ja)) assert.equal(r.ja, r.en, r.ticker);
  assert.ok(all.filter(r => JAPANESE.test(r.ja)).length >= 420);
});

test("the API routes and both PRO samples carry the resolved names; scores and order stay as sent", () => {
  // Treasure Hunt: the route and the page answer from the shared copy, which carries the names (lib/research/value-check-server.ts).
  assert.match(read("../lib/research/value-check-server.ts"), /return valueSnapshotWithNames\(parseValueSnapshot\(JSON\.parse\(body\)\)\)/);
  // The whale route keeps one named copy per instance (fast open, Nov 26) and sends that copy.
  assert.match(read("../app/api/research/whales/route.ts"), /const snapshot = whaleSnapshotWithNames\(parseWhaleSnapshot\(JSON\.parse\(body\)\)\)/);
  const snapshot = { ...treasureHuntSample, universes: { ...treasureHuntSample.universes, tech: { ...treasureHuntSample.universes.tech,
    items: [{ ...treasureHuntSample.universes.tech.items[0], ticker: "HUBS", ja: "HUBSPOT INC", en: "HUBSPOT INC" }, ...treasureHuntSample.universes.tech.items.slice(1)] } } };
  const named = valueSnapshotWithNames(snapshot);
  assert.equal(named.universes.tech.items[0].ja, "HubSpot");
  assert.deepEqual(named.universes.tech.items.map(r => [r.ticker, r.score, r.in]), snapshot.universes.tech.items.map(r => [r.ticker, r.score, r.in]));
  assert.deepEqual(named, valueSnapshotWithNames(named));
  // The samples keep the mockup's short names (PR #755) but follow the same rules: no legal suffix, no capitals, no "AMD社".
  const sampleRows = [...treasureHuntSample.universes.tech.items, ...treasureHuntSample.universes.all.items,
    ...whaleTracksSample.institutional, ...whaleTracksSample.short, ...whaleTracksSample.insiders, ...whaleTracksSample.buybacks];
  assert.ok(sampleRows.length > 0);
  for (const { ticker, ja, en } of sampleRows) {
    assert.equal(cleanEnglishName(en), en, ticker);
    assert.doesNotMatch(ja, /(?<=[A-Za-z0-9])社$|\b(?:INC|CORP|LTD|PLC)\b|[(（]/, `${ticker} ${ja}`);
  }
  // The maps stay on the server: no client screen imports them.
  for (const screen of ["../app/research/treasure-hunt/screen.tsx", "../app/research/whales/screen.tsx", "../lib/research/value-check.ts", "../lib/research/whale-moves.ts"])
    assert.doesNotMatch(read(screen), /company-display-names/);
});
