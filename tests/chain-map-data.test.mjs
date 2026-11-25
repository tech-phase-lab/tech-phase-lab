import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as chain from '../lib/research/chain-map-data.ts';
import { companyNetworkFor } from '../lib/research/chain-network.server.ts';

const data = chain.chainDataFor('NVDA');
const ALL = readdirSync(new URL('../data/chain/', import.meta.url)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
const hasJapanese = text => /[぀-ヿ㐀-鿿]/.test(text);

test('the NVDA chain map data keeps its companies, rows and two-step links', () => {
  assert.equal(chain.chainDataFor('ZZZZ'), null);
  assert.equal(data.companies.length, 22);
  assert.equal(data.far.length, 3);
  assert.deepEqual(data.rows.map(row => row.ja), ['供給元(上流)', '光通信・半導体', 'サーバー・ネットワーク', 'クラウド・AI基盤']);
  assert.deepEqual(data.rivals, ['INTC', 'ANET', 'AVGO', 'AMD']);
  assert.deepEqual(chain.chainCounts(data), { companies: 22, relations: 31 });
  const ids = new Set(data.companies.map(company => company.id));
  assert.equal(ids.size, 22);
  for (const link of data.far) assert.ok(ids.has(link.from) && ids.has(link.to));
  for (const company of data.companies) assert.ok(company.row >= 0 && company.row < data.rows.length, company.id);
  assert.deepEqual(CHAIN().map(kind => chain.chainGroup(data, kind).length), [4, 7, 6, 5]);
});
const CHAIN = () => chain.CHAIN_KINDS;

// One id must mean one real company across every map (HD is The Home Depot, not HD Hyundai).
// Names are compared after dropping legal suffixes and parentheses; one name may extend the other
// ("Merck" / "Merck & Co."). Ids whose real company goes by unrelated names are listed with every
// accepted spelling, so a different company reusing one of these ids still fails.
const COMPANY_NAME_ALIASES = {
  ADP: ["adp", "automaticdataprocessing"],
  AEP: ["aep", "americanelectricpower"],
  AMD: ["amd", "advancedmicrodevices"],
  AMZN: ["aws", "amazon", "amazoncom", "amazonkuiper", "amazonwholefoods", "amazonprimevideo", "amazonwebservices", "amazonwholefoodsmarket"],
  BKNG: ["booking", "priceline"],
  BLCO: ["bauschlomb", "bauschandlomb"],
  CFG: ["citizensbankna", "citizensfinancial"],
  CIFR: ["ciphermining", "cipherdigital"],
  COMM: ["commscope", "vistancenetworks"],
  DIS: ["disney", "waltdisney", "disneycruiseline"],
  DISH: ["dishnetwork", "dishwireless"],
  Electrolux: ["electrolux", "abelectrolux"],
  FIS: ["fis", "fidelityinformationservices", "fidelitynationalinformationservices"],
  Foxconn: ["honhai", "foxconn"],
  GE: ["geaviation", "geaerospace", "generalelectric"],
  GOOG: ["google", "alphabet"],
  GOOGL: ["google", "youtube", "alphabet", "googlecloud"],
  HPE: ["hpe", "hewlettpackardenterprise"],
  IFF: ["iff", "flavorsandfragrances"],
  IHG: ["ihghotelsandresorts", "intercontinentalhotels"],
  IMXI: ["intermex", "moneyexpress"],
  JD: ["jdcom", "jdcloud"],
  LOREAL: ["loral", "loreal"],
  LSEG: ["lseg", "londonstockexchange"],
  LVMH: ["lvmh", "sephora"],
  MMC: ["marshmclennan", "marshandmclennan", "marshandmclennancompanies"],
  MSGE: ["msgentertainment", "madisonsquaregardenentertainment"],
  Maaden: ["maaden", "saudiarabianmining"],
  ODP: ["odp", "officedepot"],
  OI: ["oiglass", "owensillinois"],
  ORLY: ["oreillyautoparts", "oreillyautomotive"],
  OXY: ["occidentalchemical", "occidentalpetroleum"],
  PEG: ["pseg", "publicserviceelectricandgas"],
  PHG: ["philips", "royalphilips", "koninklijkephilips"],
  PPL: ["ppl", "lgandeandku"],
  ROCHE: ["roche", "rochediagnostics", "hoffmannlarochegenentech"],
  SAIC: ["saic", "scienceapplications"],
  SLAB: ["siliconlabs", "siliconlaboratories"],
  SPACEX: ["spacex", "spaceexploration"],
  SPCX: ["spacex", "spaceexploration"],
  TD: ["tdbank", "torontodominionbank"],
  TEF: ["telefnica", "telefonica"],
  TSM: ["tsmc", "taiwansemiconductormanufacturing"],
  UMC: ["umc", "unitedmicroelectronics"],
  UNH: ["optum", "unitedhealth", "unitedhealthcare"],
  UPS: ["ups", "upslogistics", "unitedparcelservice"],
  WTW: ["wtw", "willistowerswatson"],
};
const companyKey = name => name.toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, '').replace(/[’'.,]/g, '')
  .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|group|holdings?|se|ag|sa|nv|llc|lp|the|technologies|technology|international|systems)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '');

test('a company id refers to the same real company in every chain map', () => {
  const names = new Map();
  for (const ticker of ALL) {
    const map = JSON.parse(readFileSync(new URL(`../data/chain/${ticker}.json`, import.meta.url), 'utf8'));
    for (const company of map.companies) {
      const key = companyKey(company.name_en ?? company.name);
      if (!names.has(company.id)) names.set(company.id, new Map());
      names.get(company.id).set(key, ticker);
    }
  }
  const clashes = [];
  for (const [id, keys] of names) {
    const sorted = [...keys.keys()].sort((a, b) => a.length - b.length);
    if (sorted.every(key => key.startsWith(sorted[0]))) continue;
    const allowed = COMPANY_NAME_ALIASES[id] ?? [];
    for (const key of sorted) if (!allowed.includes(key)) clashes.push(`${id}: "${key}" in ${keys.get(key)}.json`);
  }
  assert.deepEqual(clashes, []);
  assert.deepEqual([...names.get('HD').keys()], ['homedepot']);
  assert.deepEqual([...names.get('HDHyundai').keys()], ['hdhyundai']);
});

test('every relation has Japanese and English text and a linked, labelled source; press items are marked', () => {
  const sources = [...data.companies.flatMap(company => company.relations), ...data.far];
  assert.equal(sources.length, 31);
  for (const item of sources) {
    assert.ok(item.text && hasJapanese(item.text), item.text);
    assert.ok(item.text_en && !hasJapanese(item.text_en), item.text_en);
    const source = item.source;
    assert.match(source.url, /^https:\/\//);
    assert.ok(['official', 'press'].includes(source.level));
    assert.ok(source.label && source.label_en && !hasJapanese(source.label_en), source.label);
    if (source.note) assert.ok(source.note_en && !hasJapanese(source.note_en));
  }
  assert.equal(sources.filter(item => item.source.level === 'press').length, 4);
  assert.deepEqual(data.companies.find(company => company.id === 'INTC').relations.map(relation => relation.type), ['tie', 'rival']);
});

const require = createRequire(import.meta.url);
function compile(file, extra) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../app/research/stocks/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.css') ? { default: {} } : extra[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const { StockChainMap } = compile('stock-chain-map', { '@/lib/research/chain-map-core': chain });
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');

test('the map shows suppliers first, no range buttons, a card per company and every source in one closed 「出典」 at the bottom', () => {
  for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(createElement(StockChainMap, { data, lang }));
    // 22 company chips + the root, minus the ones folded behind a row's "＋" chip (plus that chip).
    assert.equal((html.match(/<button/g) ?? []).length, 21);
    assert.ok(!html.includes('直接の関係') && !html.includes('2段先まで'));
    // Owner, Nov 25: no per-card 「出典・引用・発表日」; one closed 「出典」 after the footer note lists every relation's and far link's source.
    assert.equal((html.match(/<details/g) ?? []).length, 1);
    assert.ok(html.indexOf('data-chain-sources') > html.indexOf(lang === 'ja' ? '投資判断を勧めるものではありません' : 'Not investment advice'));
    assert.equal((html.match(/<li[^>]*><span><b>/g) ?? []).length, data.companies.reduce((sum, company) => sum + company.relations.length, 0) + data.far.length);
    assert.ok(html.indexOf(lang === 'ja' ? '供給元(上流)' : 'Suppliers (upstream)') < html.indexOf('NVDA</b>'));
    assert.ok(html.includes(lang === 'ja' ? '22社 · 31の関係' : '22 companies · 31 relationships'));
    assert.ok(html.includes(lang === 'ja' ? 'さらに先の関係' : 'Related connections'));
    assert.ok(!html.includes('出典・引用・発表日') && !html.includes('Sources, quotes &amp; dates') && !html.includes('3段先以降'));
    assert.ok(html.includes(lang === 'ja' ? '報道' : 'Media report'));
    assert.equal((html.match(/id="chain-card-/g) ?? []).length, 22);
    // The Japanese view never shows English-only copy; the English view never shows Japanese.
    const visible = html.replace(/<q[^>]*>.*?<\/q>/g, '').replace(/<a [^>]*>/g, '<a>');
    if (lang === 'en') assert.ok(!hasJapanese(visible.replace(/<[^>]+>/g, ' ')), 'English view has Japanese text');
  }
});

const BATCH = {
  NFLX: [15, 19], LRCX: [22, 24], TSLA: [20, 22], IBM: [29, 42], META: [33, 37],
  BE: [13, 16], SKHY: [14, 16], GEV: [19, 20], MSFT: [24, 29], KLAC: [9, 11],
  SNDK: [9, 17], AMD: [24, 33], ANET: [17, 23], ARM: [31, 32], LITE: [11, 16],
  INTC: [16, 20], QCOM: [17, 21], GOOGL: [21, 24], AAPL: [25, 26], AMZN: [21, 25],
  VRT: [17, 19], PLTR: [24, 25], CEG: [9, 9], AAOI: [13, 13], NBIS: [14, 15],
  APH: [11, 13], NOW: [26, 30], STX: [14, 16], ALAB: [32, 35], IONQ: [18, 22],
  SOFI: [15, 17], CRWV: [36, 42], IREN: [15, 23], COHR: [10, 12], AMAT: [12, 14],
  PANW: [39, 46], SNOW: [16, 27], DELL: [14, 19], MRVL: [39, 52], CRM: [26, 34], AVGO: [23, 26], CRDO: [15, 19], CRWD: [19, 25], ORCL: [27, 41],
  VST: [9, 9], ADBE: [24, 24], MU: [10, 12], ASML: [11, 14], TSM: [26, 30],
};

test('the earnings-ordered companies use the same format with an official source on every relation', () => {
  for (const ticker of ALL.filter(name => name !== 'NVDA')) {
    const { companies, relations } = BATCH[ticker] ? { companies: BATCH[ticker][0], relations: BATCH[ticker][1] } : chain.chainCounts(chain.chainDataFor(ticker));
    const item = chain.chainDataFor(ticker);
    assert.ok(item, ticker);
    assert.equal(item.root.ticker, ticker);
    assert.deepEqual(chain.chainCounts(item), { companies, relations }, ticker);
    const ids = new Set(item.companies.map(company => company.id));
    assert.equal(ids.size, companies, ticker);
    for (const id of item.rivals) assert.ok(ids.has(id), `${ticker} rival ${id}`);
    assert.equal(item.far.length, 0);
    for (const company of item.companies) {
      assert.ok(company.row >= 0 && company.row < item.rows.length, company.id);
      assert.ok(company.sub && company.sub_en && !hasJapanese(company.sub_en), company.id);
      assert.ok(item.rows[company.row], `${ticker} ${company.id} row`);
      for (const relation of company.relations) {
        assert.ok(relation.text && hasJapanese(relation.text), relation.text);
        assert.ok(relation.text_en && !hasJapanese(relation.text_en), relation.text_en);
        const source = relation.source;
        assert.match(source.url, /^https:\/\//);
        assert.ok(source.level === 'official' || (ticker === 'IREN' && company.id === 'Anthropic' && source.level === 'press'), `${ticker} ${company.id}`);
        assert.ok(source.label && source.label_en && !hasJapanese(source.label_en), source.label);
        if (source.note) assert.ok(source.note_en && !hasJapanese(source.note_en));
        if (source.quote) assert.ok(!hasJapanese(source.quote), source.quote);
      }
    }
  }
});

test('a map without suppliers, rivals or two-step links leaves those parts out, and META puts several rows above the root', () => {
  const lrcx = chain.chainDataFor('LRCX'), be = chain.chainDataFor('BE'), meta = chain.chainDataFor('META');
  assert.ok(chain.chainAbove(lrcx, 0) && !chain.chainAbove(lrcx, 1));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(row => chain.chainAbove(meta, row)), [true, true, true, false, true, false]);
  const html = renderToStaticMarkup(createElement(StockChainMap, { data: be, lang: 'ja' }));
  assert.ok(!html.includes('供給元(上流)'), 'an empty supplier row is not drawn');
  assert.ok(html.indexOf('AIデータセンター・IT企業') > html.indexOf('BE</b>'));
  assert.ok(html.includes('13社 · 16の関係') && !html.includes('さらに先の関係'));
  // OXY has an empty supplier row and no rivals: the rivals parts are left out.
  const oxy = chain.chainDataFor('OXY');
  const oxyHtml = renderToStaticMarkup(createElement(StockChainMap, { data: oxy, lang: 'ja' }));
  assert.ok(!oxyHtml.includes('さらに先の関係') && !oxyHtml.includes('競合は？'));
  const plain = renderToStaticMarkup(createElement(StockChainMap, { data: oxy, lang: 'en' }));
  assert.ok(!plain.includes('Who competes with it?') && !plain.includes('Related connections') && !plain.includes('Competitors'));
  const metaHtml = renderToStaticMarkup(createElement(StockChainMap, { data: meta, lang: 'en' }));
  assert.ok(metaHtml.indexOf('Power') < metaHtml.indexOf('META</b>') && metaHtml.indexOf('META</b>') < metaHtml.indexOf('Glasses, social'));
  assert.ok(metaHtml.indexOf('AI &amp; device partners') < metaHtml.indexOf('META</b>'));
  assert.equal((metaHtml.match(/id="chain-card-/g) ?? []).length, 33);
});

test('the "who competes" row stays on one line (main rivals only), and unlisted companies are not shown', () => {
  const UNLISTED = ['TikTok', 'xAI', 'Groq', 'Scale AI', 'Crusoe', 'Westinghouse', 'Framatome', 'BMC', 'Semes', 'CXMT', 'imec', 'SK ecoplant'];
  for (const ticker of ALL) {
    const item = chain.chainDataFor(ticker);
    const labels = item.rivals.map(id => item.companies.find(company => company.id === id).ticker);
    const width = labels.reduce((sum, label) => sum + label.length * 7.8 + 24, 0) + 8 * Math.max(0, labels.length - 1);
    assert.ok(width <= 320, `${ticker} rivals row ${Math.round(width)}px`);
    for (const company of item.companies) assert.ok(!UNLISTED.includes(company.ticker) && !UNLISTED.includes(company.name), `${ticker} ${company.id}`);
  }
});

test('the English view of every map has no Japanese left in it', () => {
  for (const ticker of ALL) {
    const html = renderToStaticMarkup(createElement(StockChainMap, { data: chain.chainDataFor(ticker), lang: 'en' }));
    const match = html.match(/[぀-ヿ㐀-鿿]+/);
    assert.equal(match, null, `${ticker}: ${match?.[0]}`);
  }
});

test('the stock page gets a network record for every company that has a quoted chain map', () => {
  for (const ticker of ALL.filter(name => name !== 'NVDA')) assert.ok(companyNetworkFor({ cik: chain.chainDataFor(ticker).root.cik, ticker }), ticker);
  assert.equal(companyNetworkFor({ cik: 0, ticker: 'ZZZZ' }), null);
  assert.equal(companyNetworkFor({ cik: 1, ticker: 'ZM' }), null);
});

test('the repeated "competes with <root>" sentence is not drawn on rival cards, but more specific rival text still is', () => {
  const standard = chain.chainDataFor('SANM');
  for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(createElement(StockChainMap, { data: standard, lang }));
    assert.ok(!html.includes(lang === 'ja' ? `${standard.root.name}と競合する` : `Competes with ${standard.root.name_en ?? standard.root.name}`), lang);
    assert.ok(html.includes('data-tone="rival"'));
  }
  const specific = chain.chainDataFor('CRDO');
  const text = specific.companies.flatMap(company => company.relations).find(relation => relation.type === 'rival' && relation.text !== `${specific.root.name}と競合する`).text;
  assert.ok(renderToStaticMarkup(createElement(StockChainMap, { data: specific, lang: 'ja' })).includes(text.replace(/&/g, '&amp;')));
});

test('the PRO tour sample leaves out 「05 競合は？」 and numbers the map heading 05; the stock page keeps 05 rivals and 06 map', () => {
  const nvda = chain.chainDataFor('NVDA');
  for (const lang of ['ja', 'en']) {
    const rivals = lang === 'ja' ? '競合は？' : 'Who competes with it?', map = lang === 'ja' ? 'どこと繋がる？' : 'Who does it work with?';
    const page = renderToStaticMarkup(createElement(StockChainMap, { data: nvda, lang }));
    assert.ok(page.includes(`<span>05</span>${rivals}`) && page.includes(`<span>06</span>${map}`));
    const sample = renderToStaticMarkup(createElement(StockChainMap, { data: nvda, lang, sample: true }));
    assert.ok(!sample.includes(rivals) && sample.includes(`<span>05</span>${map}`) && !sample.includes('<span>06</span>'));
  }
  const ui = readFileSync(new URL('../app/research/pro-experience/samples/relation-map.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<StockChainMap [^>]*\bsample \/>/);
});

// Owner, Nov 24: every map card is the compact size the short cards had before (74px; 49px for the label inside the padding)
// and shows its label on one line, so each company has a short label that fits. Widths are the site font's at 10.5px, measured
// in Chromium (a full-width character is 11px there, a little wider than on a phone).
const GLYPH = { 1: "',.", 2: '!()', 3: ' ":;I`ijl|', 3.1: 'f', 3.5: 't', 4: '1-[]^r{', 4.1: '/\\', 5: '369#*+?Tcos}', 5.1: 'k', 6: '0478&=EFLX_abdegpquvxyz~', 7: '25$<>ACDGJKOPQRSVYZhn', 8: '%BHNU', 9: '@Mmw', 10: 'W' };
const glyph = char => char.codePointAt(0) > 0x2E7F ? 11 : Number(Object.keys(GLYPH).find(width => GLYPH[width].includes(char)) ?? 6);
const labelWidth = text => [...text].reduce((sum, char) => sum + glyph(char), 0);
test('every company in every map has a short card label that fits one line of the compact card', () => {
  for (const ticker of ALL) {
    for (const company of chain.chainDataFor(ticker).companies) {
      const where = `${ticker} ${company.id}`;
      assert.ok(company.sub_short && company.sub_short_en, where);
      assert.ok(labelWidth(company.sub_short) <= 49, `${where}: ${company.sub_short}`);
      assert.ok(labelWidth(company.sub_short_en) <= 49 && !hasJapanese(company.sub_short_en), `${where}: ${company.sub_short_en}`);
      for (const label of [company.sub_short, company.sub_short_en]) assert.ok(!/…|\.\.\./.test(label) && label === label.trim(), `${where}: ${label}`);
    }
  }
  const html = renderToStaticMarkup(createElement(StockChainMap, { data: chain.chainDataFor('SONO'), lang: 'ja' }));
  assert.match(html, /<small title="PC周辺機器・オーディオ">PC周辺<\/small>/);
  assert.match(html, /<small title="車載ミラー・電子機器">車載電子<\/small>/);
  const css = readFileSync(new URL('../app/research/stocks/stock-chain-map.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.chips \{ display: grid; grid-template-columns: repeat\(auto-fill, 74px\);/);
  assert.doesNotMatch(css, /\.chips > \.chip:not\(\.root\) \{ padding/);
  assert.match(css, /\.chips > \.chip:not\(\.root\) small \{ white-space: nowrap; \}/);
});
