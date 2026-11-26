import test from "node:test";
import assert from "node:assert/strict";
import { parseCompanyWire } from "../lib/research/company-wire.ts";
import { COVERED, topicNoise } from "../lib/research/topic-noise.ts";
import { sameTopic, topicCards } from "../lib/research/topics.ts";
import { otcTicker, primaryTickers, tickerLabel, wireStories } from "../lib/research/wire-stories.ts";

// Owner, Nov 26 (「関係のない記事は、あなたのほうで消してほしい」): the production 注目トピック list of Nov 26, by kind.
const now = Date.parse("2026-11-26T03:00:00Z");
const iso = minutes => new Date(now - minutes * 60_000).toISOString();
const item = (id, titleEn, titleJa, { publisher = "Reuters", minutes = 10, url = `https://news.example/${id}`, origin = "third-party" } = {}) => ({
  id, titleEn, titleJa, shortJa: null, publisher, origin, url, publishedAt: iso(minutes), source: "stocknews" });

test("routine notices, talk and promotions are not topics; results, deals and covered companies' listing news are", () => {
  const dropped = {
    conference: [["Applied Optoelectronics to Present at the Raymond James TMT & Consumer Conference", "AAOI"],
      ["Autodesk to present at upcoming investor conferences", "ADSK"], ["ARRAY Technologies to Participate in Upcoming Investor Conference", "ARRY"],
      ["Cellebrite Announces Participation in the UBS Global Technology and AI Conference", "CLBT"],
      ["CrowdStrike to Participate in Upcoming Investor Conferences", "CRWD"], ["FormFactor Announces Participation at Upcoming Conferences", "FORM"],
      ["Dropbox to Present at the 2026 UBS Global Technology and AI Conference", "DBX"]],
    "earnings-date": [["Cango Inc. to Report Third Quarter 2026 Financial Results on November 30, 2026, Eastern Time", "CANG"],
      ["Evertz Technologies Limited to Announce Second Quarter 2027 Results on December 2, 2026", "EVTZF"],
      ["Hydreight Technologies Announces Timing of Q3 2026 Financial Results and Earnings Call", "HYDTF"]],
    "option-grant": [["Uniserve Announces Grant of Incentive Stock Options", "USSHF"]],
    "small-financing": [["Freedom Gold Corp. Announces Extension and Amendment of FT Offering and Extension of Unit Offering", "MKT"],
      ["VisionWave Holdings, Inc. Announces $2.0 Million Registered Direct Offering", "VWAV"], ["MineHub Closes First Tranche of Financing", "MHUBF"],
      ["NUE Power Corp. Upgrades to the OTCQB Venture Market", "NUEPF"]],
    deficiency: [["Foresight Announces Receipt of Nasdaq Notice", "FRSX"], ["iQIYI Announces Receipt of Minimum Bid Price Notice from Nasdaq", "IQ"],
      ["Fusemachines Granted Nasdaq Listing Extension and Approval to Transfer to Nasdaq Capital Market", "FUSE"]],
    talk: [["Where the market may be mispricing risk most: AI boom, volatility, high-yield bonds", "MKT"],
      ["Former Tesla engineer says AI will create more 'fake jobs' — not mass unemployment", "TSLA"],
      ["Anthropic Rebounds From 10% Drop as Markets Stage Dramatic Recovery | Closing Bell", "ANT"]],
    promo: [["CDW Canada Named 2026 Cisco Partner of the Year for Cloud & AI and SMB", "CDW"],
      ["In partnership with Amazon, Duracell Brings Holiday Magic to Chicago with Power Playland on the Pier", "AMZN"],
      ["Globant announces Converge 2026: an edition about reinvention in the AI-Native Era, with Glob.AI at the center", "GLOB"]],
    "etf-options": [["Options Now Available on ANUU, ANDD & ANSS: Leverage Shares by Themes 2X Long, 2X Short and 1X Short Anthropic (ANT) ETFs", "ANT"]],
  };
  for (const [kind, rows] of Object.entries(dropped)) for (const [title, ticker] of rows) assert.equal(topicNoise(title, "GlobeNewsWire", [ticker]), kind, title);
  assert.equal(topicNoise("Holtz-Eakin: 50bps Hike Would Send 'Important Message'", "Bloomberg Markets and Finance", ["MKT"]), "talk", "a TV clip");
  for (const [title, ticker] of [["GDS Holdings Limited Reports Third Quarter 2026 Results", "GDS"], ["Formula Systems Reports Third Quarter 2026 Financial Results", "FORTY"],
    ["South Korea raises rates to highest in two years, as inflation remains above target", "MKT"], ["Lockheed wins $1.2 billion Army contract award", "LMT"],
    ["Solar panel maker First Solar raises guidance", "FSLR"], ["Locafy Announces Termination of Proposed Map Labs Acquisition", "LCFY"],
    ["IQM Quantum Computers Plc has received a new order for an IQM Radiance 54-qubit quantum computer from QAI", "IQMX"],
    ["Nvidia to report third-quarter results on November 19", "NVDA"], ["Micron prices $2 billion private placement of notes", "MU"],
    ["Nebius receives Nasdaq notice", "NBIS"]]) assert.equal(topicNoise(title, "Reuters", [ticker]), null, title);
  assert.ok(COVERED.has("NVDA") && COVERED.has("MU") && !COVERED.has("IQ"));
  assert.ok(COVERED.has("AAOI") && COVERED.has("CRWD"), "Theme Ranking and earnings-calendar names are covered");
});

test("owner's spec of Nov 26: small-cap financing, single miners and small-cap wires without a covered company are dropped", () => {
  for (const [title, publisher, tickers, kind] of [
    ["Freedom Gold Corp. Announces Extension and Amendment of FT Offering and Extension of Unit Offering", "Newsfile Corp", ["MKT"], "small-financing"],
    ["Freedom Gold Corp. Reports Assay Results", "Newsfile Corp", ["MKT"], "mining"],
    ["RIWI Releases Q3 2026 Financials", "Newsfile Corp", ["RWCRF"], "small-wire"],
    ["Acme Tech Announces Product Launch", "ACCESS Newswire", ["ACME"], "small-wire"],
    ["Northern Lithium Corp. Reports Drill Results at Lake Property", "GlobeNewsWire", ["NLTHF"], "mining"],
    ["Acme Announces Exercise of Warrants and Extension of Warrant Term", "GlobeNewsWire", ["ACME"], "small-financing"],
    ["Acme Closes Non-Brokered Private Placement", "PRNewsWire", ["ACME"], "small-financing"],
  ]) assert.equal(topicNoise(title, publisher, tickers), kind, title);
  for (const [title, publisher, tickers] of [
    ["Micron Announces Product Update", "Newsfile Corp", ["MU"]], ["Gold hits a record as the dollar slides", "Reuters", ["MKT"]],
    ["Fed holds rates steady", "WSJ", ["MKT"]], ["Nasdaq 100 rises 1% on chip rally", "CNBC", ["MKT"]],
    ["Agnico Eagle Mines Ltd. reports record gold output", "Reuters", ["AEM"]],
  ]) assert.equal(topicNoise(title, publisher, tickers), COVERED.has(tickers[0]) || tickers[0] === "MKT" ? null : "mining", title);
});

test("OTC tickers are shown by the company's name; an unknown OTC line is left out of a topic card", () => {
  assert.equal(tickerLabel("KXHCF", true), "キオクシア");
  assert.equal(tickerLabel("KXIAY", false), "Kioxia");
  assert.equal(tickerLabel("NVDA", true), "NVDA");
  assert.equal(otcTicker("LLEIF"), true);
  assert.equal(otcTicker("FORTY"), false, "a Nasdaq ADR ending in Y keeps its ticker");
  const wire = parseCompanyWire({ ok: true, items: { LLEIF: [item("l1", "Lleida.net surpasses 20,000 active customers", "Lleida.net、アクティブ顧客数が2万人を突破")] } }).items;
  assert.equal(topicCards(null, wire, "ja")[0].tickers, "");
});

test("the topics page drops them, shows one ticker per company, no 市場 on a press release, and IQM's order once", () => {
  const wire = parseCompanyWire({ ok: true, items: {
    MKT: [item("f1", "Freedom Gold Corp. Announces Extension and Amendment of FT Offering", "フリーダム・ゴールド社、FT募集の延長を発表", { publisher: "Newsfile Corp", origin: "wire" }),
      item("m1", "Cyber Corp. Announces Q3 Results", "サイバー社が第3四半期決算を発表", { publisher: "Business Wire", origin: "wire", minutes: 15 }),
      item("m2", "Bank of Korea Resumes Rate Hikes", "韓国銀行、利上げ再開", { publisher: "WSJ", minutes: 20 })],
    KXHCF: [item("k1", "Kioxia and NVIDIA Collaborate to Expand HBM Capacity", "キオクシアとエヌビディアが協業", { publisher: "Business Wire", url: "https://news.example/k" })],
    KXIAY: [item("k2", "Kioxia and NVIDIA Collaborate to Expand HBM Capacity", "キオクシアとエヌビディアが協業", { publisher: "Business Wire", url: "https://news.example/k" })],
    IQMX: [item("q1", "IQM Quantum Computers Partners with QAI, a South Korean Quantum-AI company to Deploy a Quantum Computer in Their Private AI Data Center in Korea",
      "IQM、韓国QAIと提携", { publisher: "Business Wire", minutes: 30 }),
    item("q2", "Inside information: IQM Quantum Computers Plc has received a new order for an IQM Radiance 54-qubit quantum computer from QAI, a South Korean quantum AI company",
      "IQM、韓国QAI社から量子コンピュータを受注", { publisher: "GlobeNewsWire", minutes: 50 })],
    AAOI: [item("a1", "Applied Optoelectronics to Present at the Raymond James TMT & Consumer Conference", "アプライド・オプトエレクトロニクス、会議で発表予定")],
  } }).items;
  const cards = topicCards(null, wire, "ja");
  assert.deepEqual(cards.map(card => [card.tickers, card.title]), [
    ["キオクシア", "キオクシアとエヌビディアが協業"], ["", "サイバー社が第3四半期決算を発表"], ["市場", "韓国銀行、利上げ再開"], ["IQMX", "IQM、韓国QAI社から量子コンピュータを受注"]]);
  assert.equal(sameTopic("Nvidia shares rise after earnings beat", "Nvidia shares fall after earnings miss"), false);
  assert.equal(sameTopic("Klarna Expands Price Comparison Tool Across Europe", "Klarna Announces Major Canada Expansion With Launch of Flexible Virtual Card"), false);
  assert.equal(sameTopic("Kioxia and NVIDIA Collaborate to Expand Effective High-Bandwidth Memory Capacity with SSDs",
    "KIOXIA GP2 Series SSD Delivers New Levels of Performance for GPU Memory Expansion"), false, "two Kioxia releases stay two");
  assert.deepEqual(primaryTickers(["KXHCF", "KXIAY"]), ["KXIAY"]);
  assert.deepEqual(primaryTickers(["OTGLF", "OTGLY"]), ["OTGLY"]);
  assert.deepEqual(primaryTickers(["HYDTF", "VSQTF"]), ["HYDTF", "VSQTF"], "two companies keep both");
  assert.deepEqual(primaryTickers(["KXHCF"]), ["KXHCF"]);
});

test("the home list keeps look-alike headlines of different companies apart; one article filed under two companies is one row", () => {
  const wire = parseCompanyWire({ ok: true, items: {
    GDS: [item("g1", "GDS Holdings Limited Reports Third Quarter 2026 Results", "GDSホールディングス、2026年第3四半期決算を発表", { publisher: "GlobeNewsWire", minutes: 300 })],
    LICT: [item("l1", "LICT Corporation Reports Third Quarter 2026 Results", "LICT、2026年第3四半期決算を発表", { publisher: "Business Wire", minutes: 60 })],
    BDCTF: [item("b1", "BuildDirect Reports Third Quarter 2026 Financial Results", "BuildDirect、第3四半期決算を発表", { publisher: "Newsfile Corp", minutes: 100 })],
    MACT: [item("t1", "MachTen Reports Financial Results for the Third Quarter of 2026", "MachTen、第3四半期決算を発表", { publisher: "GlobeNewsWire", minutes: 90 })],
    KXHCF: [item("k1", "Kioxia and NVIDIA Collaborate to Expand HBM Capacity", "キオクシアとエヌビディアが協業", { publisher: "Business Wire", url: "https://news.example/k" })],
    KXIAY: [item("k2", "Kioxia and NVIDIA Collaborate to Expand HBM Capacity", "キオクシアとエヌビディアが協業", { publisher: "Business Wire", url: "https://news.example/k" })],
  } }).items;
  assert.deepEqual(wireStories(wire, "ja").map(story => story.tickers.join(" · ")), ["KXIAY", "LICT", "MACT", "BDCTF", "GDS"]);
});
